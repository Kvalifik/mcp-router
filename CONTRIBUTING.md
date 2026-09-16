# Contributing

Thank you for helping improve MCP Router.

1. Discuss substantial changes in an issue before investing in them.
2. Keep changes focused, with a clear description and relevant tests.
3. Run `npm test` and `npm run build:ui` before submitting a pull request.
4. Use synthetic fixtures. Never include live OAuth grants, client content,
   machine-specific paths, private logs, or configuration backups.
5. Explain changes to permissions, OAuth, provider endpoints, and data handling.

By intentionally submitting a contribution for inclusion, you offer it under
this repository's MCP Router Source-Available License 1.1 and confirm that you
have authority to do so. You retain ownership of your contribution. This is not
a copyright assignment, patent grant, or permission to relicense contributions
under unrelated terms. Obtain your employer's permission where necessary.

Keep third-party licenses and notices intact. Do not add vendor logos without
verified permission for redistribution and the intended use. Be respectful and
avoid posting confidential information. Security issues belong at
contact@kvalifik.dk, not in public issues.

## Adding files

The repository uses an explicit publication allowlist in `.gitignore`. New
files are ignored by default. Review their contents, then add an exact path
entry if they belong in the public source. Never force-add private data, local
configuration, internal drafts or generated release files.
