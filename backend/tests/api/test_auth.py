"""
JWT Authentication test suite.

Covers: signup, duplicate signup, login, invalid credentials,
        token validation, protected routes, refresh, logout, change-password.
"""
from datetime import datetime, timedelta, timezone

import pytest
from fakeredis import FakeAsyncRedis
from httpx import AsyncClient
from jose import jwt

from app.core.config import settings
from app.core.security import decode_token

BASE = "/api/v1/auth"

# A password that satisfies every strength rule
VALID_PW = "TestPass1"

# ─────────────────────────────────────────────────────────────────────────────
# Request helpers
# ─────────────────────────────────────────────────────────────────────────────

async def _register(
    client: AsyncClient,
    *,
    email: str = "user@test.com",
    name: str = "Test User",
    password: str = VALID_PW,
):
    return await client.post(
        f"{BASE}/register",
        json={"name": name, "email": email, "password": password},
    )


async def _login(
    client: AsyncClient,
    *,
    email: str = "user@test.com",
    password: str = VALID_PW,
):
    return await client.post(
        f"{BASE}/login",
        json={"email": email, "password": password},
    )


async def _me(client: AsyncClient, token: str):
    return await client.get(f"{BASE}/me", headers={"Authorization": f"Bearer {token}"})


async def _refresh(client: AsyncClient, refresh_token: str):
    return await client.post(f"{BASE}/refresh", json={"refresh_token": refresh_token})


async def _logout(client: AsyncClient, access_token: str, refresh_token: str | None = None):
    return await client.post(
        f"{BASE}/logout",
        json={"refresh_token": refresh_token},
        headers={"Authorization": f"Bearer {access_token}"},
    )


# ─────────────────────────────────────────────────────────────────────────────
# Token factories for edge cases
# ─────────────────────────────────────────────────────────────────────────────

def _expired_token(user_id: str = "uid-1") -> str:
    return jwt.encode(
        {
            "sub": user_id,
            "jti": "expired-jti",
            "exp": datetime.now(timezone.utc) - timedelta(minutes=5),
            "type": "access",
        },
        settings.SECRET_KEY,
        settings.ALGORITHM,
    )


def _wrong_signature_token(user_id: str = "uid-1") -> str:
    return jwt.encode(
        {
            "sub": user_id,
            "jti": "bad-sig",
            "exp": datetime.now(timezone.utc) + timedelta(hours=1),
            "type": "access",
        },
        "completely-wrong-secret",
        settings.ALGORITHM,
    )


# ─────────────────────────────────────────────────────────────────────────────
# 1. Signup
# ─────────────────────────────────────────────────────────────────────────────

class TestSignup:

    async def test_success_returns_201(self, client: AsyncClient):
        res = await _register(client)
        assert res.status_code == 201

    async def test_returns_access_and_refresh_tokens(self, client: AsyncClient):
        body = (await _register(client)).json()
        assert "access_token" in body
        assert "refresh_token" in body

    async def test_token_type_is_bearer(self, client: AsyncClient):
        assert (await _register(client)).json()["token_type"] == "bearer"

    async def test_access_token_has_required_claims(self, client: AsyncClient):
        payload = decode_token((await _register(client)).json()["access_token"])
        assert payload["type"] == "access"
        assert "sub" in payload
        assert "jti" in payload
        assert "exp" in payload

    async def test_refresh_token_has_required_claims(self, client: AsyncClient):
        payload = decode_token((await _register(client)).json()["refresh_token"])
        assert payload["type"] == "refresh"
        assert "sub" in payload
        assert "jti" in payload

    async def test_access_and_refresh_have_different_jtis(self, client: AsyncClient):
        tokens = (await _register(client)).json()
        at_jti = decode_token(tokens["access_token"])["jti"]
        rt_jti = decode_token(tokens["refresh_token"])["jti"]
        assert at_jti != rt_jti

    async def test_refresh_jti_stored_in_redis(self, client: AsyncClient, fake_redis: FakeAsyncRedis):
        tokens = (await _register(client)).json()
        rt_jti = decode_token(tokens["refresh_token"])["jti"]
        assert await fake_redis.get(f"refresh:{rt_jti}") is not None

    async def test_email_stored_as_lowercase(self, client: AsyncClient):
        tokens = (await _register(client, email="UPPER@TEST.COM")).json()
        body = (await _me(client, tokens["access_token"])).json()
        assert body["email"] == "upper@test.com"


# ─────────────────────────────────────────────────────────────────────────────
# 2. Duplicate signup
# ─────────────────────────────────────────────────────────────────────────────

class TestDuplicateSignup:

    async def test_same_email_returns_409(self, client: AsyncClient):
        await _register(client)
        assert (await _register(client)).status_code == 409

    async def test_case_insensitive_duplicate_returns_409(self, client: AsyncClient):
        await _register(client, email="Alice@Example.COM")
        assert (await _register(client, email="alice@example.com")).status_code == 409

    async def test_different_email_succeeds(self, client: AsyncClient):
        await _register(client, email="a@test.com")
        assert (await _register(client, email="b@test.com")).status_code == 201


# ─────────────────────────────────────────────────────────────────────────────
# 3. Signup validation
# ─────────────────────────────────────────────────────────────────────────────

class TestSignupValidation:

    @pytest.mark.parametrize("email", [
        "notanemail",
        "missing@",
        "@nodomain.com",
        "two@@signs.com",
        "",
    ])
    async def test_invalid_email_returns_422(self, client: AsyncClient, email: str):
        res = await client.post(
            f"{BASE}/register",
            json={"name": "T", "email": email, "password": VALID_PW},
        )
        assert res.status_code == 422

    @pytest.mark.parametrize("password,description", [
        ("short1A",        "7 chars — too short"),
        ("alllowercase1",  "no uppercase letter"),
        ("ALLUPPERCASE1",  "no lowercase letter"),
        ("NoDigitsHere",   "no digit"),
        ("",               "empty string"),
    ])
    async def test_weak_password_returns_422(
        self, client: AsyncClient, password: str, description: str
    ):
        res = await client.post(
            f"{BASE}/register",
            json={"name": "T", "email": "pw@test.com", "password": password},
        )
        assert res.status_code == 422, f"expected 422 for: {description}"

    async def test_blank_name_returns_422(self, client: AsyncClient):
        res = await client.post(
            f"{BASE}/register",
            json={"name": "   ", "email": "x@test.com", "password": VALID_PW},
        )
        assert res.status_code == 422

    async def test_missing_password_returns_422(self, client: AsyncClient):
        assert (
            await client.post(f"{BASE}/register", json={"name": "T", "email": "x@test.com"})
        ).status_code == 422

    async def test_missing_email_returns_422(self, client: AsyncClient):
        assert (
            await client.post(f"{BASE}/register", json={"name": "T", "password": VALID_PW})
        ).status_code == 422

    async def test_empty_body_returns_422(self, client: AsyncClient):
        assert (await client.post(f"{BASE}/register", json={})).status_code == 422


# ─────────────────────────────────────────────────────────────────────────────
# 4. Login success
# ─────────────────────────────────────────────────────────────────────────────

class TestLogin:

    async def test_success_returns_200(self, client: AsyncClient):
        await _register(client)
        assert (await _login(client)).status_code == 200

    async def test_returns_both_tokens(self, client: AsyncClient):
        await _register(client)
        body = (await _login(client)).json()
        assert "access_token" in body and "refresh_token" in body

    async def test_each_login_issues_unique_tokens(self, client: AsyncClient):
        await _register(client)
        t1 = (await _login(client)).json()["access_token"]
        t2 = (await _login(client)).json()["access_token"]
        assert t1 != t2
        assert decode_token(t1)["jti"] != decode_token(t2)["jti"]

    async def test_email_is_case_insensitive(self, client: AsyncClient):
        await _register(client, email="case@test.com")
        assert (await _login(client, email="CASE@TEST.COM")).status_code == 200

    async def test_missing_password_returns_422(self, client: AsyncClient):
        res = await client.post(f"{BASE}/login", json={"email": "x@test.com"})
        assert res.status_code == 422


# ─────────────────────────────────────────────────────────────────────────────
# 5. Invalid credentials
# ─────────────────────────────────────────────────────────────────────────────

class TestInvalidCredentials:

    async def test_wrong_password_returns_401(self, client: AsyncClient):
        await _register(client)
        assert (await _login(client, password="WrongPass9")).status_code == 401

    async def test_unknown_email_returns_401(self, client: AsyncClient):
        assert (await _login(client, email="nobody@test.com")).status_code == 401

    async def test_wrong_password_error_message_is_generic(self, client: AsyncClient):
        """Don't reveal whether the email exists."""
        await _register(client)
        body = (await _login(client, password="WrongPass9")).json()
        assert body["detail"] == "Invalid credentials"

    async def test_unknown_email_error_message_is_generic(self, client: AsyncClient):
        body = (await _login(client, email="nobody@test.com")).json()
        assert body["detail"] == "Invalid credentials"


# ─────────────────────────────────────────────────────────────────────────────
# 6. Token validation
# ─────────────────────────────────────────────────────────────────────────────

class TestTokenValidation:

    async def test_malformed_token_returns_401(self, client: AsyncClient):
        assert (await _me(client, "not.a.jwt")).status_code == 401

    async def test_random_string_returns_401(self, client: AsyncClient):
        assert (await _me(client, "randomstringtoken")).status_code == 401

    async def test_wrong_signature_returns_401(self, client: AsyncClient):
        assert (await _me(client, _wrong_signature_token())).status_code == 401

    async def test_expired_token_returns_401(self, client: AsyncClient):
        assert (await _me(client, _expired_token())).status_code == 401

    async def test_refresh_token_rejected_as_access_token(self, client: AsyncClient):
        """Passing a refresh token as a Bearer must be rejected."""
        tokens = (await _register(client)).json()
        assert (await _me(client, tokens["refresh_token"])).status_code == 401

    async def test_access_token_sub_matches_user_id(self, client: AsyncClient):
        tokens = (await _register(client)).json()
        payload = decode_token(tokens["access_token"])
        body = (await _me(client, tokens["access_token"])).json()
        assert str(body["id"]) == payload["sub"]


# ─────────────────────────────────────────────────────────────────────────────
# 7. Protected routes
# ─────────────────────────────────────────────────────────────────────────────

class TestProtectedRoutes:

    async def test_valid_token_returns_200(self, client: AsyncClient):
        tokens = (await _register(client)).json()
        assert (await _me(client, tokens["access_token"])).status_code == 200

    async def test_no_token_returns_401(self, client: AsyncClient):
        # Starlette ≥0.40 HTTPBearer returns 401; older versions returned 403
        assert (await client.get(f"{BASE}/me")).status_code in (401, 403)

    async def test_empty_bearer_returns_403(self, client: AsyncClient):
        res = await client.get(f"{BASE}/me", headers={"Authorization": "Bearer "})
        assert res.status_code in (401, 403)

    async def test_response_contains_expected_fields(self, client: AsyncClient):
        await _register(client, email="fields@test.com", name="Fields User")
        token = (await _login(client, email="fields@test.com")).json()["access_token"]
        body = (await _me(client, token)).json()
        assert body["email"] == "fields@test.com"
        assert body["name"] == "Fields User"
        assert "id" in body
        assert "created_at" in body

    async def test_response_never_leaks_password_hash(self, client: AsyncClient):
        tokens = (await _register(client)).json()
        body = (await _me(client, tokens["access_token"])).json()
        assert "password_hash" not in body
        assert "password" not in body

    async def test_tokens_from_different_users_are_isolated(self, client: AsyncClient):
        t_a = (await _register(client, email="a@test.com", name="Alice")).json()["access_token"]
        t_b = (await _register(client, email="b@test.com", name="Bob")).json()["access_token"]
        assert (await _me(client, t_a)).json()["name"] == "Alice"
        assert (await _me(client, t_b)).json()["name"] == "Bob"


# ─────────────────────────────────────────────────────────────────────────────
# 8. Token refresh
# ─────────────────────────────────────────────────────────────────────────────

class TestTokenRefresh:

    async def test_success_returns_200(self, client: AsyncClient):
        tokens = (await _register(client)).json()
        assert (await _refresh(client, tokens["refresh_token"])).status_code == 200

    async def test_returns_new_token_pair(self, client: AsyncClient):
        tokens = (await _register(client)).json()
        new_tokens = (await _refresh(client, tokens["refresh_token"])).json()
        assert "access_token" in new_tokens and "refresh_token" in new_tokens

    async def test_tokens_are_rotated(self, client: AsyncClient):
        tokens = (await _register(client)).json()
        new_tokens = (await _refresh(client, tokens["refresh_token"])).json()
        assert new_tokens["access_token"] != tokens["access_token"]
        assert new_tokens["refresh_token"] != tokens["refresh_token"]
        assert decode_token(new_tokens["refresh_token"])["jti"] != decode_token(tokens["refresh_token"])["jti"]

    async def test_old_refresh_token_rejected_after_rotation(self, client: AsyncClient):
        """Replay attack: the old refresh token must be invalidated after one use."""
        tokens = (await _register(client)).json()
        old_rt = tokens["refresh_token"]
        await _refresh(client, old_rt)
        assert (await _refresh(client, old_rt)).status_code == 401

    async def test_access_token_rejected_as_refresh(self, client: AsyncClient):
        tokens = (await _register(client)).json()
        assert (await _refresh(client, tokens["access_token"])).status_code == 401

    async def test_invalid_token_returns_401(self, client: AsyncClient):
        assert (await _refresh(client, "not-a-token")).status_code == 401

    async def test_expired_refresh_token_returns_401(self, client: AsyncClient):
        assert (await _refresh(client, _expired_token())).status_code == 401

    async def test_new_access_token_is_usable_on_protected_routes(self, client: AsyncClient):
        tokens = (await _register(client)).json()
        new_tokens = (await _refresh(client, tokens["refresh_token"])).json()
        assert (await _me(client, new_tokens["access_token"])).status_code == 200

    async def test_new_refresh_jti_stored_in_redis(self, client: AsyncClient, fake_redis: FakeAsyncRedis):
        tokens = (await _register(client)).json()
        new_tokens = (await _refresh(client, tokens["refresh_token"])).json()
        new_jti = decode_token(new_tokens["refresh_token"])["jti"]
        assert await fake_redis.get(f"refresh:{new_jti}") is not None


# ─────────────────────────────────────────────────────────────────────────────
# 9. Logout
# ─────────────────────────────────────────────────────────────────────────────

class TestLogout:

    async def test_returns_204(self, client: AsyncClient):
        tokens = (await _register(client)).json()
        res = await _logout(client, tokens["access_token"], tokens["refresh_token"])
        assert res.status_code == 204

    async def test_access_token_blocklisted_after_logout(self, client: AsyncClient):
        tokens = (await _register(client)).json()
        at = tokens["access_token"]
        await _logout(client, at, tokens["refresh_token"])
        assert (await _me(client, at)).status_code == 401

    async def test_refresh_token_revoked_after_logout(self, client: AsyncClient):
        tokens = (await _register(client)).json()
        await _logout(client, tokens["access_token"], tokens["refresh_token"])
        assert (await _refresh(client, tokens["refresh_token"])).status_code == 401

    async def test_logout_without_refresh_token_still_succeeds(self, client: AsyncClient):
        tokens = (await _register(client)).json()
        assert (await _logout(client, tokens["access_token"])).status_code == 204

    async def test_access_token_blocklisted_even_without_refresh_in_body(self, client: AsyncClient):
        tokens = (await _register(client)).json()
        at = tokens["access_token"]
        await _logout(client, at)  # no refresh_token in body
        assert (await _me(client, at)).status_code == 401

    async def test_requires_auth(self, client: AsyncClient):
        assert (await client.post(f"{BASE}/logout", json={})).status_code in (401, 403)

    async def test_double_logout_is_idempotent(self, client: AsyncClient):
        """Logout is stateless on the access token side — calling twice is harmless."""
        tokens = (await _register(client)).json()
        at = tokens["access_token"]
        assert (await _logout(client, at)).status_code == 204
        assert (await _logout(client, at)).status_code == 204  # JWT still valid, just blocklisted

    async def test_access_jti_written_to_blocklist_in_redis(
        self, client: AsyncClient, fake_redis: FakeAsyncRedis
    ):
        tokens = (await _register(client)).json()
        at = tokens["access_token"]
        at_jti = decode_token(at)["jti"]
        await _logout(client, at)
        assert await fake_redis.exists(f"blocklist:{at_jti}") == 1

    async def test_refresh_jti_deleted_from_redis_after_logout(
        self, client: AsyncClient, fake_redis: FakeAsyncRedis
    ):
        tokens = (await _register(client)).json()
        rt_jti = decode_token(tokens["refresh_token"])["jti"]
        await _logout(client, tokens["access_token"], tokens["refresh_token"])
        assert await fake_redis.get(f"refresh:{rt_jti}") is None

    async def test_blocklist_ttl_is_set(
        self, client: AsyncClient, fake_redis: FakeAsyncRedis
    ):
        """Blocklisted JTIs must expire — not accumulate forever."""
        tokens = (await _register(client)).json()
        at = tokens["access_token"]
        at_jti = decode_token(at)["jti"]
        await _logout(client, at)
        ttl = await fake_redis.ttl(f"blocklist:{at_jti}")
        assert ttl > 0


# ─────────────────────────────────────────────────────────────────────────────
# 10. Change password
# ─────────────────────────────────────────────────────────────────────────────

class TestChangePassword:

    async def _setup(self, client: AsyncClient, email: str = "chg@test.com"):
        """Register + login, return access token."""
        await _register(client, email=email)
        return (await _login(client, email=email)).json()["access_token"]

    async def _change(
        self,
        client: AsyncClient,
        token: str,
        current: str = VALID_PW,
        new: str = "NewPass456",
    ):
        return await client.post(
            f"{BASE}/change-password",
            json={"current_password": current, "new_password": new},
            headers={"Authorization": f"Bearer {token}"},
        )

    async def test_success_returns_204(self, client: AsyncClient):
        token = await self._setup(client)
        assert (await self._change(client, token)).status_code == 204

    async def test_wrong_current_password_returns_400(self, client: AsyncClient):
        token = await self._setup(client, email="chg1@test.com")
        assert (await self._change(client, token, current="WrongPass9")).status_code == 400

    async def test_weak_new_password_returns_422(self, client: AsyncClient):
        token = await self._setup(client, email="chg2@test.com")
        assert (await self._change(client, token, new="weak")).status_code == 422

    async def test_old_password_rejected_after_change(self, client: AsyncClient):
        await _register(client, email="chg3@test.com")
        token = (await _login(client, email="chg3@test.com")).json()["access_token"]
        await self._change(client, token, current=VALID_PW, new="NewPass456")
        assert (await _login(client, email="chg3@test.com", password=VALID_PW)).status_code == 401

    async def test_new_password_accepted_after_change(self, client: AsyncClient):
        await _register(client, email="chg4@test.com")
        token = (await _login(client, email="chg4@test.com")).json()["access_token"]
        await self._change(client, token, current=VALID_PW, new="NewPass456")
        assert (await _login(client, email="chg4@test.com", password="NewPass456")).status_code == 200

    async def test_requires_auth(self, client: AsyncClient):
        res = await client.post(
            f"{BASE}/change-password",
            json={"current_password": VALID_PW, "new_password": "NewPass456"},
        )
        assert res.status_code in (401, 403)

    async def test_new_password_must_meet_strength_rules(self, client: AsyncClient):
        token = await self._setup(client, email="chg5@test.com")
        for weak in ("nouppercase1", "NOLOWERCASE1", "NoDigitsHere", "short1A"):
            res = await self._change(client, token, new=weak)
            assert res.status_code == 422, f"expected 422 for weak pw: {weak!r}"
