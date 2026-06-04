import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Enables `node server.js` in the Docker production image.
  output: "standalone",

  webpack(config) {
    // @tiptap/extension-collaboration@3.x uses @tiptap/y-tiptap which creates
    // its own ySyncPluginKey. @tiptap/extension-collaboration-cursor imports
    // yCursorPlugin from y-prosemirror which has a *different* ySyncPluginKey
    // instance. Since ProseMirror PluginKey uses object identity, the cursor
    // plugin can't find the sync state → "ystate.doc is undefined".
    //
    // Aliasing y-prosemirror → @tiptap/y-tiptap makes both extensions share
    // the same module instance and therefore the same ySyncPluginKey.
    config.resolve.alias = {
      ...config.resolve.alias,
      "y-prosemirror": require.resolve("@tiptap/y-tiptap"),
    };
    return config;
  },
};

export default nextConfig;
