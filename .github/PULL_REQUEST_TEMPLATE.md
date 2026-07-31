## What this changes

<!-- What a user can now do, or now sees correctly. One or two sentences. -->

Closes #

## How it was verified

<!-- Which tests, and what you saw on a real machine. "typecheck+lint+test green"
     is the floor, not the answer. -->

- [ ] `npm run typecheck`
- [ ] `npm run lint`
- [ ] `npm test`
- [ ] Ran it against a real distro and looked at the result

## The four rules

<!-- See .github/CONTRIBUTING.md. Tick what applies; if one is unticked, say why. -->

- [ ] Nothing here changes system state on its own — mutating commands are
      only *prepared* into the Console input
- [ ] Unreadable values degrade to unknown, never to `0` / `false` / empty
- [ ] No parsing of a localized word — position, shape or an ASCII marker only
- [ ] No secret can reach a renderer, an export or an MCP response unmasked

## Screenshots

<!-- For anything visible. Before / after if you changed existing UI. -->
