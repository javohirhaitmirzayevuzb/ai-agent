/**
 * next.config.js — AI Cover & Post Studio
 *
 * Note: no host allowlist is needed — the app is fully relative-URL based, so it
 * works behind any proxy/preview host, and /api/file/* streams through the same origin.
 */

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Keep a throwaway server (isolated selftest) out of the live .next dir: two dev
  // servers sharing one build dir delete each other's chunks and 500 with missing-manifest errors.
  distDir: process.env.STUDIO_DIST_DIR || '.next',
  reactStrictMode: true,
  poweredByHeader: false,
  // Reference designs and generated art are posted as data URLs (up to ~16MB) —
  // route handlers stream the body, and src/lib/http.js enforces the cap.
  eslint: { ignoreDuringBuilds: true },
};

export default nextConfig;
