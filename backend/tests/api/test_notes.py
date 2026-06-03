"""
Notes CRUD test suite.

Coverage:
  TestNoteCRUD          — create / read / update / delete happy paths
  TestNoteListOrdering  — pin-first sort, archived exclusion, workspace isolation
  TestNoteValidation    — Pydantic validators, UUID format, content type
  TestNoteAuthorization — full role matrix (unauthenticated → owner)
  TestNotePin           — toggle behavior, viewer permission, list ordering
  TestVersionHistory    — create, list, restore, pre-restore snapshot, isolation
"""
import pytest
from httpx import AsyncClient

VALID_PW = "TestPass1"
BASE = "/api/v1"

# A realistic TipTap document used as note content throughout the tests
TIPTAP_DOC = {
    "type": "doc",
    "content": [{"type": "paragraph", "content": [{"type": "text", "text": "Hello world"}]}],
}
TIPTAP_DOC_V2 = {
    "type": "doc",
    "content": [{"type": "paragraph", "content": [{"type": "text", "text": "Updated text"}]}],
}

# ─────────────────────────────────────────────────────────────────────────────
# Request helpers
# ─────────────────────────────────────────────────────────────────────────────

def _h(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


async def _register(client: AsyncClient, email: str) -> str:
    """Register and return access token."""
    res = await client.post(
        f"{BASE}/auth/register",
        json={"name": "Test User", "email": email, "password": VALID_PW},
    )
    return res.json()["access_token"]


async def _login(client: AsyncClient, email: str) -> str:
    res = await client.post(
        f"{BASE}/auth/login", json={"email": email, "password": VALID_PW}
    )
    return res.json()["access_token"]


async def _create_workspace(client: AsyncClient, token: str, name: str = "Test WS") -> str:
    res = await client.post(
        f"{BASE}/workspaces/", json={"name": name}, headers=_h(token)
    )
    return res.json()["id"]


async def _invite(client: AsyncClient, owner_token: str, ws_id: str, email: str, role: str) -> str:
    """Register a new user, invite them to the workspace, return their token."""
    await _register(client, email)
    await client.post(
        f"{BASE}/workspaces/{ws_id}/members",
        json={"email": email, "role": role},
        headers=_h(owner_token),
    )
    return await _login(client, email)


async def _create_note(
    client: AsyncClient,
    token: str,
    ws_id: str,
    title: str = "My Note",
    content: dict | None = None,
) -> dict:
    body: dict = {"title": title}
    if content is not None:
        body["content"] = content
    res = await client.post(f"{BASE}/workspaces/{ws_id}/notes/", json=body, headers=_h(token))
    return res


def _notes(ws_id: str) -> str:
    return f"{BASE}/workspaces/{ws_id}/notes"


async def _full_setup(client: AsyncClient, email: str = "owner@test.com") -> tuple[str, str, str]:
    """Register, workspace, note → (token, ws_id, note_id)."""
    token = await _register(client, email)
    ws_id = await _create_workspace(client, token)
    note = (await _create_note(client, token, ws_id)).json()
    return token, ws_id, note["id"]


# ─────────────────────────────────────────────────────────────────────────────
# 1. CRUD
# ─────────────────────────────────────────────────────────────────────────────

class TestNoteCRUD:

    # ── create ──────────────────────────────────────────────────────────────

    async def test_create_returns_201(self, client: AsyncClient):
        token, ws_id, _ = await _full_setup(client)
        res = await _create_note(client, token, ws_id, "New")
        assert res.status_code == 201

    async def test_create_stores_title(self, client: AsyncClient):
        token, ws_id, _ = await _full_setup(client)
        res = await _create_note(client, token, ws_id, "My Note")
        assert res.json()["title"] == "My Note"

    async def test_create_stores_content(self, client: AsyncClient):
        token, ws_id, _ = await _full_setup(client)
        res = await _create_note(client, token, ws_id, "Doc", TIPTAP_DOC)
        assert res.json()["content"] == TIPTAP_DOC

    async def test_create_sets_created_by(self, client: AsyncClient):
        token, ws_id, _ = await _full_setup(client)
        me = (await client.get(f"{BASE}/auth/me", headers=_h(token))).json()
        note = (await _create_note(client, token, ws_id)).json()
        assert note["created_by"] == me["id"]

    async def test_create_not_pinned_by_default(self, client: AsyncClient):
        token, ws_id, _ = await _full_setup(client)
        note = (await _create_note(client, token, ws_id)).json()
        assert note["is_pinned"] is False

    async def test_create_not_archived_by_default(self, client: AsyncClient):
        token, ws_id, _ = await _full_setup(client)
        note = (await _create_note(client, token, ws_id)).json()
        assert note["is_archived"] is False

    async def test_create_updated_by_is_null_initially(self, client: AsyncClient):
        token, ws_id, _ = await _full_setup(client)
        note = (await _create_note(client, token, ws_id)).json()
        assert note["updated_by"] is None

    # ── read ────────────────────────────────────────────────────────────────

    async def test_get_returns_200(self, client: AsyncClient):
        token, ws_id, note_id = await _full_setup(client)
        res = await client.get(f"{_notes(ws_id)}/{note_id}", headers=_h(token))
        assert res.status_code == 200

    async def test_get_response_has_content_field(self, client: AsyncClient):
        token, ws_id, _ = await _full_setup(client)
        note = (await _create_note(client, token, ws_id, "X", TIPTAP_DOC)).json()
        fetched = (
            await client.get(f"{_notes(ws_id)}/{note['id']}", headers=_h(token))
        ).json()
        assert "content" in fetched
        assert fetched["content"] == TIPTAP_DOC

    async def test_get_archived_note_still_accessible(self, client: AsyncClient):
        """Soft-delete does not block direct fetch."""
        token, ws_id, note_id = await _full_setup(client)
        await client.delete(f"{_notes(ws_id)}/{note_id}", headers=_h(token))
        res = await client.get(f"{_notes(ws_id)}/{note_id}", headers=_h(token))
        assert res.status_code == 200
        assert res.json()["is_archived"] is True

    async def test_get_unknown_note_returns_404(self, client: AsyncClient):
        token, ws_id, _ = await _full_setup(client)
        fake_id = "00000000-0000-0000-0000-000000000001"
        res = await client.get(f"{_notes(ws_id)}/{fake_id}", headers=_h(token))
        assert res.status_code == 404

    async def test_get_note_from_wrong_workspace_returns_404(self, client: AsyncClient):
        """Note belongs to ws_a — accessing via ws_b must return 404."""
        token, ws_a_id, note_id = await _full_setup(client)
        ws_b_id = await _create_workspace(client, token, "WS B")
        res = await client.get(f"{_notes(ws_b_id)}/{note_id}", headers=_h(token))
        assert res.status_code == 404

    # ── update ──────────────────────────────────────────────────────────────

    async def test_update_title_returns_200(self, client: AsyncClient):
        token, ws_id, note_id = await _full_setup(client)
        res = await client.patch(
            f"{_notes(ws_id)}/{note_id}", json={"title": "Renamed"}, headers=_h(token)
        )
        assert res.status_code == 200
        assert res.json()["title"] == "Renamed"

    async def test_update_content_returns_200(self, client: AsyncClient):
        token, ws_id, note_id = await _full_setup(client)
        res = await client.patch(
            f"{_notes(ws_id)}/{note_id}", json={"content": TIPTAP_DOC}, headers=_h(token)
        )
        assert res.status_code == 200
        assert res.json()["content"] == TIPTAP_DOC

    async def test_update_both_fields(self, client: AsyncClient):
        token, ws_id, note_id = await _full_setup(client)
        res = await client.patch(
            f"{_notes(ws_id)}/{note_id}",
            json={"title": "New Title", "content": TIPTAP_DOC},
            headers=_h(token),
        )
        body = res.json()
        assert body["title"] == "New Title"
        assert body["content"] == TIPTAP_DOC

    async def test_update_sets_updated_by(self, client: AsyncClient):
        token, ws_id, note_id = await _full_setup(client)
        me = (await client.get(f"{BASE}/auth/me", headers=_h(token))).json()
        note = (
            await client.patch(
                f"{_notes(ws_id)}/{note_id}", json={"title": "X"}, headers=_h(token)
            )
        ).json()
        assert note["updated_by"] == me["id"]

    async def test_update_empty_body_is_no_op(self, client: AsyncClient):
        """PATCH with no recognised fields → 200, note unchanged."""
        token, ws_id, note_id = await _full_setup(client)
        original = (
            await client.get(f"{_notes(ws_id)}/{note_id}", headers=_h(token))
        ).json()
        res = await client.patch(
            f"{_notes(ws_id)}/{note_id}", json={}, headers=_h(token)
        )
        assert res.status_code == 200
        assert res.json()["title"] == original["title"]

    async def test_update_title_is_stripped(self, client: AsyncClient):
        token, ws_id, note_id = await _full_setup(client)
        res = await client.patch(
            f"{_notes(ws_id)}/{note_id}", json={"title": "  Trimmed  "}, headers=_h(token)
        )
        assert res.json()["title"] == "Trimmed"

    async def test_update_unknown_note_returns_404(self, client: AsyncClient):
        token, ws_id, _ = await _full_setup(client)
        fake_id = "00000000-0000-0000-0000-000000000002"
        res = await client.patch(
            f"{_notes(ws_id)}/{fake_id}", json={"title": "X"}, headers=_h(token)
        )
        assert res.status_code == 404

    # ── delete ──────────────────────────────────────────────────────────────

    async def test_delete_returns_204(self, client: AsyncClient):
        token, ws_id, note_id = await _full_setup(client)
        res = await client.delete(f"{_notes(ws_id)}/{note_id}", headers=_h(token))
        assert res.status_code == 204

    async def test_delete_is_soft_delete(self, client: AsyncClient):
        """Deleted note is archived, not hard-deleted."""
        token, ws_id, note_id = await _full_setup(client)
        await client.delete(f"{_notes(ws_id)}/{note_id}", headers=_h(token))
        note = (
            await client.get(f"{_notes(ws_id)}/{note_id}", headers=_h(token))
        ).json()
        assert note["is_archived"] is True

    async def test_delete_unknown_note_returns_404(self, client: AsyncClient):
        token, ws_id, _ = await _full_setup(client)
        fake_id = "00000000-0000-0000-0000-000000000003"
        res = await client.delete(f"{_notes(ws_id)}/{fake_id}", headers=_h(token))
        assert res.status_code == 404


# ─────────────────────────────────────────────────────────────────────────────
# 2. List ordering and filtering
# ─────────────────────────────────────────────────────────────────────────────

class TestNoteListOrdering:

    async def test_list_returns_200(self, client: AsyncClient):
        token, ws_id, _ = await _full_setup(client)
        res = await client.get(f"{_notes(ws_id)}/", headers=_h(token))
        assert res.status_code == 200
        assert isinstance(res.json(), list)

    async def test_list_response_has_no_content_field(self, client: AsyncClient):
        """GET / returns NoteListItem — content JSONB is excluded."""
        token, ws_id, _ = await _full_setup(client, "listshape@test.com")
        items = (await client.get(f"{_notes(ws_id)}/", headers=_h(token))).json()
        assert len(items) > 0
        assert "content" not in items[0]

    async def test_list_excludes_archived_notes(self, client: AsyncClient):
        token, ws_id, note_id = await _full_setup(client, "archive@test.com")
        await client.delete(f"{_notes(ws_id)}/{note_id}", headers=_h(token))
        items = (await client.get(f"{_notes(ws_id)}/", headers=_h(token))).json()
        ids = [n["id"] for n in items]
        assert note_id not in ids

    async def test_list_pinned_notes_appear_first(self, client: AsyncClient):
        token, ws_id, note_a_id = await _full_setup(client, "pinorder@test.com")

        # Create a second note, then pin the first one
        note_b = (await _create_note(client, token, ws_id, "Note B")).json()
        await client.post(f"{_notes(ws_id)}/{note_a_id}/pin", headers=_h(token))

        items = (await client.get(f"{_notes(ws_id)}/", headers=_h(token))).json()
        ids = [n["id"] for n in items]
        assert ids.index(note_a_id) < ids.index(note_b["id"])

    async def test_list_only_shows_current_workspace_notes(self, client: AsyncClient):
        """Notes from workspace B must not appear in workspace A's list."""
        token, ws_a_id, _ = await _full_setup(client, "isolated@test.com")
        ws_b_id = await _create_workspace(client, token, "WS B")
        await _create_note(client, token, ws_b_id, "WS-B Note")

        items = (await client.get(f"{_notes(ws_a_id)}/", headers=_h(token))).json()
        assert all(n["workspace_id"] == ws_a_id for n in items)

    async def test_list_contains_all_required_fields(self, client: AsyncClient):
        token, ws_id, _ = await _full_setup(client, "fields@test.com")
        item = (await client.get(f"{_notes(ws_id)}/", headers=_h(token))).json()[0]
        for field in ("id", "workspace_id", "title", "is_pinned", "is_archived", "created_at", "updated_at"):
            assert field in item, f"missing field: {field}"


# ─────────────────────────────────────────────────────────────────────────────
# 3. Validation
# ─────────────────────────────────────────────────────────────────────────────

class TestNoteValidation:

    async def test_create_blank_title_defaults_to_untitled(self, client: AsyncClient):
        token, ws_id, _ = await _full_setup(client, "vblank@test.com")
        note = (await _create_note(client, token, ws_id, "   ")).json()
        assert note["title"] == "Untitled"

    async def test_create_whitespace_title_stripped(self, client: AsyncClient):
        token, ws_id, _ = await _full_setup(client, "vstrip@test.com")
        note = (await _create_note(client, token, ws_id, "  Hello  ")).json()
        assert note["title"] == "Hello"

    async def test_create_empty_body_uses_default_title(self, client: AsyncClient):
        """NoteCreate has all-optional fields; empty body → title=Untitled."""
        token = await _register(client, "vempty@test.com")
        ws_id = await _create_workspace(client, token)
        res = await client.post(f"{_notes(ws_id)}/", json={}, headers=_h(token))
        assert res.status_code == 201
        assert res.json()["title"] == "Untitled"

    async def test_update_blank_title_returns_422(self, client: AsyncClient):
        token, ws_id, note_id = await _full_setup(client, "vupd@test.com")
        res = await client.patch(
            f"{_notes(ws_id)}/{note_id}", json={"title": ""}, headers=_h(token)
        )
        assert res.status_code == 422

    async def test_update_whitespace_only_title_returns_422(self, client: AsyncClient):
        token, ws_id, note_id = await _full_setup(client, "vws@test.com")
        res = await client.patch(
            f"{_notes(ws_id)}/{note_id}", json={"title": "   "}, headers=_h(token)
        )
        assert res.status_code == 422

    @pytest.mark.parametrize("content", [
        "plain string",
        42,
        True,
        ["array", "not", "allowed"],
    ])
    async def test_create_non_object_content_returns_422(
        self, client: AsyncClient, content
    ):
        """Content must be a JSON object (dict) or null."""
        token = await _register(client, f"vcontent_{id(content)}@test.com")
        ws_id = await _create_workspace(client, token)
        res = await client.post(
            f"{_notes(ws_id)}/", json={"content": content}, headers=_h(token)
        )
        assert res.status_code == 422

    async def test_invalid_workspace_uuid_returns_422(self, client: AsyncClient):
        token = await _register(client, "vuuid_ws@test.com")
        res = await client.get(
            f"{BASE}/workspaces/not-a-uuid/notes/", headers=_h(token)
        )
        assert res.status_code == 422

    async def test_invalid_note_uuid_returns_422(self, client: AsyncClient):
        token, ws_id, _ = await _full_setup(client, "vuuid_note@test.com")
        res = await client.get(f"{_notes(ws_id)}/not-a-uuid", headers=_h(token))
        assert res.status_code == 422


# ─────────────────────────────────────────────────────────────────────────────
# 4. Authorization
# ─────────────────────────────────────────────────────────────────────────────

class TestNoteAuthorization:

    # ── unauthenticated ──────────────────────────────────────────────────────

    @pytest.mark.parametrize("method,path_suffix,body", [
        ("GET",    "/",                 None),
        ("POST",   "/",                 {"title": "X"}),
        ("GET",    "/{id}",             None),
        ("PATCH",  "/{id}",             {"title": "X"}),
        ("DELETE", "/{id}",             None),
        ("POST",   "/{id}/pin",         None),
        ("GET",    "/{id}/versions",    None),
        ("POST",   "/{id}/versions",    {}),
    ])
    async def test_unauthenticated_returns_401(
        self, client: AsyncClient, method: str, path_suffix: str, body
    ):
        token, ws_id, note_id = await _full_setup(client, f"unauth_{method}_{path_suffix.strip('/')}@test.com")
        path = f"{_notes(ws_id)}{path_suffix.replace('{id}', note_id)}"
        res = await client.request(method, path, json=body)
        assert res.status_code in (401, 403)

    # ── non-member ───────────────────────────────────────────────────────────

    async def test_non_member_cannot_list_notes(self, client: AsyncClient):
        owner_token, ws_id, _ = await _full_setup(client, "nonmem_owner@test.com")
        outsider = await _register(client, "nonmem_out@test.com")
        res = await client.get(f"{_notes(ws_id)}/", headers=_h(outsider))
        assert res.status_code == 403

    async def test_non_member_cannot_create_note(self, client: AsyncClient):
        owner_token, ws_id, _ = await _full_setup(client, "nonmem_c_owner@test.com")
        outsider = await _register(client, "nonmem_c_out@test.com")
        res = await _create_note(client, outsider, ws_id)
        assert res.status_code == 403

    async def test_non_member_cannot_get_note(self, client: AsyncClient):
        owner_token, ws_id, note_id = await _full_setup(client, "nonmem_g_owner@test.com")
        outsider = await _register(client, "nonmem_g_out@test.com")
        res = await client.get(f"{_notes(ws_id)}/{note_id}", headers=_h(outsider))
        assert res.status_code == 403

    async def test_non_member_cannot_update_note(self, client: AsyncClient):
        owner_token, ws_id, note_id = await _full_setup(client, "nonmem_u_owner@test.com")
        outsider = await _register(client, "nonmem_u_out@test.com")
        res = await client.patch(
            f"{_notes(ws_id)}/{note_id}", json={"title": "X"}, headers=_h(outsider)
        )
        assert res.status_code == 403

    async def test_non_member_cannot_delete_note(self, client: AsyncClient):
        owner_token, ws_id, note_id = await _full_setup(client, "nonmem_d_owner@test.com")
        outsider = await _register(client, "nonmem_d_out@test.com")
        res = await client.delete(f"{_notes(ws_id)}/{note_id}", headers=_h(outsider))
        assert res.status_code == 403

    # ── viewer ───────────────────────────────────────────────────────────────

    async def test_viewer_can_list_notes(self, client: AsyncClient):
        owner_token, ws_id, _ = await _full_setup(client, "view_l_owner@test.com")
        viewer = await _invite(client, owner_token, ws_id, "view_l@test.com", "viewer")
        res = await client.get(f"{_notes(ws_id)}/", headers=_h(viewer))
        assert res.status_code == 200

    async def test_viewer_can_get_note(self, client: AsyncClient):
        owner_token, ws_id, note_id = await _full_setup(client, "view_g_owner@test.com")
        viewer = await _invite(client, owner_token, ws_id, "view_g@test.com", "viewer")
        res = await client.get(f"{_notes(ws_id)}/{note_id}", headers=_h(viewer))
        assert res.status_code == 200

    async def test_viewer_cannot_create_note(self, client: AsyncClient):
        owner_token, ws_id, _ = await _full_setup(client, "view_c_owner@test.com")
        viewer = await _invite(client, owner_token, ws_id, "view_c@test.com", "viewer")
        res = await _create_note(client, viewer, ws_id)
        assert res.status_code == 403

    async def test_viewer_cannot_update_note(self, client: AsyncClient):
        owner_token, ws_id, note_id = await _full_setup(client, "view_u_owner@test.com")
        viewer = await _invite(client, owner_token, ws_id, "view_u@test.com", "viewer")
        res = await client.patch(
            f"{_notes(ws_id)}/{note_id}", json={"title": "X"}, headers=_h(viewer)
        )
        assert res.status_code == 403

    async def test_viewer_cannot_delete_note(self, client: AsyncClient):
        owner_token, ws_id, note_id = await _full_setup(client, "view_d_owner@test.com")
        viewer = await _invite(client, owner_token, ws_id, "view_d@test.com", "viewer")
        res = await client.delete(f"{_notes(ws_id)}/{note_id}", headers=_h(viewer))
        assert res.status_code == 403

    async def test_viewer_can_pin_note(self, client: AsyncClient):
        """Pin uses _check_access (any member), not _check_write."""
        owner_token, ws_id, note_id = await _full_setup(client, "view_p_owner@test.com")
        viewer = await _invite(client, owner_token, ws_id, "view_p@test.com", "viewer")
        res = await client.post(f"{_notes(ws_id)}/{note_id}/pin", headers=_h(viewer))
        assert res.status_code == 200

    async def test_viewer_can_list_versions(self, client: AsyncClient):
        owner_token, ws_id, note_id = await _full_setup(client, "view_v_owner@test.com")
        viewer = await _invite(client, owner_token, ws_id, "view_v@test.com", "viewer")
        res = await client.get(f"{_notes(ws_id)}/{note_id}/versions", headers=_h(viewer))
        assert res.status_code == 200

    async def test_viewer_cannot_create_version(self, client: AsyncClient):
        owner_token, ws_id, note_id = await _full_setup(client, "view_cv_owner@test.com")
        viewer = await _invite(client, owner_token, ws_id, "view_cv@test.com", "viewer")
        res = await client.post(
            f"{_notes(ws_id)}/{note_id}/versions", json={}, headers=_h(viewer)
        )
        assert res.status_code == 403

    # ── editor ───────────────────────────────────────────────────────────────

    async def test_editor_can_create_note(self, client: AsyncClient):
        owner_token, ws_id, _ = await _full_setup(client, "edit_c_owner@test.com")
        editor = await _invite(client, owner_token, ws_id, "edit_c@test.com", "editor")
        res = await _create_note(client, editor, ws_id)
        assert res.status_code == 201

    async def test_editor_can_update_note(self, client: AsyncClient):
        owner_token, ws_id, note_id = await _full_setup(client, "edit_u_owner@test.com")
        editor = await _invite(client, owner_token, ws_id, "edit_u@test.com", "editor")
        res = await client.patch(
            f"{_notes(ws_id)}/{note_id}", json={"title": "Editor edit"}, headers=_h(editor)
        )
        assert res.status_code == 200

    async def test_editor_can_delete_note(self, client: AsyncClient):
        owner_token, ws_id, note_id = await _full_setup(client, "edit_d_owner@test.com")
        editor = await _invite(client, owner_token, ws_id, "edit_d@test.com", "editor")
        res = await client.delete(f"{_notes(ws_id)}/{note_id}", headers=_h(editor))
        assert res.status_code == 204

    # ── admin ────────────────────────────────────────────────────────────────

    async def test_admin_can_create_note(self, client: AsyncClient):
        owner_token, ws_id, _ = await _full_setup(client, "adm_c_owner@test.com")
        admin = await _invite(client, owner_token, ws_id, "adm_c@test.com", "admin")
        res = await _create_note(client, admin, ws_id)
        assert res.status_code == 201

    async def test_admin_can_update_note(self, client: AsyncClient):
        owner_token, ws_id, note_id = await _full_setup(client, "adm_u_owner@test.com")
        admin = await _invite(client, owner_token, ws_id, "adm_u@test.com", "admin")
        res = await client.patch(
            f"{_notes(ws_id)}/{note_id}", json={"title": "Admin edit"}, headers=_h(admin)
        )
        assert res.status_code == 200


# ─────────────────────────────────────────────────────────────────────────────
# 5. Pin / unpin
# ─────────────────────────────────────────────────────────────────────────────

class TestNotePin:

    async def test_pin_sets_is_pinned_true(self, client: AsyncClient):
        token, ws_id, note_id = await _full_setup(client, "pin_on@test.com")
        note = (
            await client.post(f"{_notes(ws_id)}/{note_id}/pin", headers=_h(token))
        ).json()
        assert note["is_pinned"] is True

    async def test_pin_twice_unpins(self, client: AsyncClient):
        """Second call to /pin toggles back to unpinned."""
        token, ws_id, note_id = await _full_setup(client, "pin_toggle@test.com")
        await client.post(f"{_notes(ws_id)}/{note_id}/pin", headers=_h(token))
        note = (
            await client.post(f"{_notes(ws_id)}/{note_id}/pin", headers=_h(token))
        ).json()
        assert note["is_pinned"] is False

    async def test_pin_unknown_note_returns_404(self, client: AsyncClient):
        token, ws_id, _ = await _full_setup(client, "pin_404@test.com")
        fake_id = "00000000-0000-0000-0000-000000000004"
        res = await client.post(f"{_notes(ws_id)}/{fake_id}/pin", headers=_h(token))
        assert res.status_code == 404

    async def test_pinned_note_appears_before_unpinned_in_list(self, client: AsyncClient):
        token, ws_id, note_a = await _full_setup(client, "pin_order@test.com")
        note_b = (await _create_note(client, token, ws_id, "B")).json()["id"]
        note_c = (await _create_note(client, token, ws_id, "C")).json()["id"]
        # Pin note_c (the most recently created)
        await client.post(f"{_notes(ws_id)}/{note_c}/pin", headers=_h(token))

        items = (await client.get(f"{_notes(ws_id)}/", headers=_h(token))).json()
        ids = [n["id"] for n in items]
        # Pinned note must come before all unpinned notes
        assert ids[0] == note_c
        assert note_a in ids[1:]
        assert note_b in ids[1:]

    async def test_multiple_pinned_notes_before_unpinned(self, client: AsyncClient):
        token = await _register(client, "multi_pin@test.com")
        ws_id = await _create_workspace(client, token)
        ids = []
        for i in range(4):
            n = (await _create_note(client, token, ws_id, f"Note {i}")).json()
            ids.append(n["id"])
        # Pin first two
        await client.post(f"{_notes(ws_id)}/{ids[0]}/pin", headers=_h(token))
        await client.post(f"{_notes(ws_id)}/{ids[1]}/pin", headers=_h(token))

        items = (await client.get(f"{_notes(ws_id)}/", headers=_h(token))).json()
        listed = [n["id"] for n in items]
        pinned_positions = [listed.index(ids[0]), listed.index(ids[1])]
        unpinned_positions = [listed.index(ids[2]), listed.index(ids[3])]
        assert max(pinned_positions) < min(unpinned_positions)


# ─────────────────────────────────────────────────────────────────────────────
# 6. Version history
# ─────────────────────────────────────────────────────────────────────────────

class TestVersionHistory:

    async def test_create_version_returns_201(self, client: AsyncClient):
        token, ws_id, note_id = await _full_setup(client, "ver_c@test.com")
        res = await client.post(
            f"{_notes(ws_id)}/{note_id}/versions", json={}, headers=_h(token)
        )
        assert res.status_code == 201

    async def test_version_captures_current_content(self, client: AsyncClient):
        token, ws_id, note_id = await _full_setup(client, "ver_snap@test.com")
        # Give the note some content
        await client.patch(
            f"{_notes(ws_id)}/{note_id}", json={"content": TIPTAP_DOC}, headers=_h(token)
        )
        ver = (
            await client.post(
                f"{_notes(ws_id)}/{note_id}/versions", json={}, headers=_h(token)
            )
        ).json()
        assert ver["content"] == TIPTAP_DOC

    async def test_version_stores_label(self, client: AsyncClient):
        token, ws_id, note_id = await _full_setup(client, "ver_label@test.com")
        ver = (
            await client.post(
                f"{_notes(ws_id)}/{note_id}/versions",
                json={"label": "Release v1"},
                headers=_h(token),
            )
        ).json()
        assert ver["label"] == "Release v1"

    async def test_version_without_label_has_null_label(self, client: AsyncClient):
        token, ws_id, note_id = await _full_setup(client, "ver_nolabel@test.com")
        ver = (
            await client.post(
                f"{_notes(ws_id)}/{note_id}/versions", json={}, headers=_h(token)
            )
        ).json()
        assert ver["label"] is None

    async def test_version_has_content_field(self, client: AsyncClient):
        token, ws_id, note_id = await _full_setup(client, "ver_content@test.com")
        ver = (
            await client.post(
                f"{_notes(ws_id)}/{note_id}/versions", json={}, headers=_h(token)
            )
        ).json()
        assert "content" in ver

    async def test_list_versions_returns_list(self, client: AsyncClient):
        token, ws_id, note_id = await _full_setup(client, "ver_list@test.com")
        await client.post(f"{_notes(ws_id)}/{note_id}/versions", json={}, headers=_h(token))
        await client.post(f"{_notes(ws_id)}/{note_id}/versions", json={}, headers=_h(token))
        versions = (
            await client.get(f"{_notes(ws_id)}/{note_id}/versions", headers=_h(token))
        ).json()
        assert len(versions) == 2

    async def test_list_versions_sorted_newest_first(self, client: AsyncClient):
        token, ws_id, note_id = await _full_setup(client, "ver_sort@test.com")
        await client.post(
            f"{_notes(ws_id)}/{note_id}/versions", json={"label": "first"}, headers=_h(token)
        )
        await client.post(
            f"{_notes(ws_id)}/{note_id}/versions", json={"label": "second"}, headers=_h(token)
        )
        versions = (
            await client.get(f"{_notes(ws_id)}/{note_id}/versions", headers=_h(token))
        ).json()
        assert versions[0]["label"] == "second"
        assert versions[1]["label"] == "first"

    async def test_restore_returns_note_with_version_content(self, client: AsyncClient):
        token, ws_id, note_id = await _full_setup(client, "rst_content@test.com")

        # Set content A, create version
        await client.patch(
            f"{_notes(ws_id)}/{note_id}", json={"content": TIPTAP_DOC}, headers=_h(token)
        )
        ver_id = (
            await client.post(
                f"{_notes(ws_id)}/{note_id}/versions", json={"label": "v1"}, headers=_h(token)
            )
        ).json()["id"]

        # Overwrite with content B
        await client.patch(
            f"{_notes(ws_id)}/{note_id}", json={"content": TIPTAP_DOC_V2}, headers=_h(token)
        )

        # Restore to content A
        restored = (
            await client.post(
                f"{_notes(ws_id)}/{note_id}/versions/{ver_id}/restore", headers=_h(token)
            )
        ).json()
        assert restored["content"] == TIPTAP_DOC

    async def test_restore_creates_pre_restore_snapshot(self, client: AsyncClient):
        """
        restore_version must snapshot the current state before overwriting so
        the restore operation is itself undoable.
        """
        token, ws_id, note_id = await _full_setup(client, "rst_snap@test.com")

        # Create initial version (content A)
        await client.patch(
            f"{_notes(ws_id)}/{note_id}", json={"content": TIPTAP_DOC}, headers=_h(token)
        )
        ver_id = (
            await client.post(
                f"{_notes(ws_id)}/{note_id}/versions", json={"label": "v1"}, headers=_h(token)
            )
        ).json()["id"]

        # Move to content B
        await client.patch(
            f"{_notes(ws_id)}/{note_id}", json={"content": TIPTAP_DOC_V2}, headers=_h(token)
        )

        versions_before = (
            await client.get(f"{_notes(ws_id)}/{note_id}/versions", headers=_h(token))
        ).json()

        # Restore to v1
        await client.post(
            f"{_notes(ws_id)}/{note_id}/versions/{ver_id}/restore", headers=_h(token)
        )

        versions_after = (
            await client.get(f"{_notes(ws_id)}/{note_id}/versions", headers=_h(token))
        ).json()

        # One extra version was created (the pre-restore snapshot)
        assert len(versions_after) == len(versions_before) + 1

    async def test_restore_pre_snapshot_has_before_restore_label(self, client: AsyncClient):
        token, ws_id, note_id = await _full_setup(client, "rst_label@test.com")
        await client.patch(
            f"{_notes(ws_id)}/{note_id}", json={"content": TIPTAP_DOC}, headers=_h(token)
        )
        ver_id = (
            await client.post(
                f"{_notes(ws_id)}/{note_id}/versions", json={}, headers=_h(token)
            )
        ).json()["id"]
        await client.post(
            f"{_notes(ws_id)}/{note_id}/versions/{ver_id}/restore", headers=_h(token)
        )

        versions = (
            await client.get(f"{_notes(ws_id)}/{note_id}/versions", headers=_h(token))
        ).json()
        # The newest entry (index 0) is the pre-restore snapshot
        assert "Before restore" in (versions[0]["label"] or "")

    async def test_restore_nonexistent_version_returns_404(self, client: AsyncClient):
        token, ws_id, note_id = await _full_setup(client, "rst_404@test.com")
        fake_ver = "00000000-0000-0000-0000-000000000005"
        res = await client.post(
            f"{_notes(ws_id)}/{note_id}/versions/{fake_ver}/restore", headers=_h(token)
        )
        assert res.status_code == 404

    async def test_restore_version_from_another_note_returns_404(self, client: AsyncClient):
        """A version's note_id must match the URL note_id."""
        token, ws_id, note_a = await _full_setup(client, "rst_xnote@test.com")
        note_b = (await _create_note(client, token, ws_id, "Note B")).json()["id"]

        # Create a version on note_b
        ver_id = (
            await client.post(
                f"{_notes(ws_id)}/{note_b}/versions", json={}, headers=_h(token)
            )
        ).json()["id"]

        # Try to restore note_b's version onto note_a
        res = await client.post(
            f"{_notes(ws_id)}/{note_a}/versions/{ver_id}/restore", headers=_h(token)
        )
        assert res.status_code == 404

    async def test_viewer_cannot_restore_version(self, client: AsyncClient):
        owner_token, ws_id, note_id = await _full_setup(client, "rst_view_owner@test.com")
        ver_id = (
            await client.post(
                f"{_notes(ws_id)}/{note_id}/versions", json={}, headers=_h(owner_token)
            )
        ).json()["id"]
        viewer = await _invite(client, owner_token, ws_id, "rst_view@test.com", "viewer")
        res = await client.post(
            f"{_notes(ws_id)}/{note_id}/versions/{ver_id}/restore", headers=_h(viewer)
        )
        assert res.status_code == 403

    async def test_versions_from_other_note_not_in_list(self, client: AsyncClient):
        """list_versions must be scoped to the requested note."""
        token, ws_id, note_a = await _full_setup(client, "ver_scope@test.com")
        note_b = (await _create_note(client, token, ws_id, "B")).json()["id"]
        # Create versions on note_b only
        await client.post(f"{_notes(ws_id)}/{note_b}/versions", json={}, headers=_h(token))
        await client.post(f"{_notes(ws_id)}/{note_b}/versions", json={}, headers=_h(token))

        versions_a = (
            await client.get(f"{_notes(ws_id)}/{note_a}/versions", headers=_h(token))
        ).json()
        assert len(versions_a) == 0
