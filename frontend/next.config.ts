import type { NextConfig } from "next";

// Alias explanation:
// @tiptap/extension-collaboration@3.x registers the Yjs sync plugin via
// @tiptap/y-tiptap (its own ySyncPluginKey). @tiptap/extension-collaboration-
// cursor imports yCursorPlugin from y-prosemirror which has a *different*
// ySyncPluginKey instance. ProseMirror uses object identity for plugin key
// lookups → cursor plugin returns undefined → "ystate.doc is undefined".
// Aliasing y-prosemirror → @tiptap/y-tiptap forces both to share one module
// instance and one ySyncPluginKey, fixing the crash.

const nextConfig: NextConfig = {
  output: "standalone",

  // Turbopack alias (used by `next dev` in Next.js 16)
  turbopack: {
    resolveAlias: {
      "y-prosemirror": "@tiptap/y-tiptap",
    },
  },

  // Webpack alias (used by `next build` for production)
  webpack(config) {
    config.resolve.alias = {
      ...config.resolve.alias,
      "y-prosemirror": require.resolve("@tiptap/y-tiptap"),
    };
    return config;
  },
};

export default nextConfig;
