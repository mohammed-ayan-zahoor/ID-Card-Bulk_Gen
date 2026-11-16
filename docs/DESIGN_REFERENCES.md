# Starter-screen design notes

## Research references

- [Figma: Guide to the file browser](https://help.figma.com/hc/en-us/articles/14381406380183-Guide-to-the-file-browser) describes the file browser as the place to manage an account and browse teams, folders, and files. Its Recents view, global search, and template discovery inform the workspace navigation and retrieval patterns here.
- [Figma: Set custom thumbnails for files](https://help.figma.com/hc/en-us/articles/360038511413-Set-custom-thumbnails-for-files) explains that previews appear wherever a file is listed and should reflect the file's contents. This supports using actual card artwork in project cards, instead of generic file icons.
- [Adobe Photoshop: Home screen overview](https://helpx.adobe.com/photoshop/desktop/get-started/learn-the-basics/homescreen-overview.html) describes a home screen with New File, Open, Recents, keyword filters, and an organized Your Files area. These are useful patterns for a tool that moves between designing and editing existing cards.
- [Adobe Express: Template Browser V2](https://developer.adobe.com/express/embed-sdk/docs/guides/concepts/template-browser-v2) describes separating a user's own files/projects from custom templates, with Recent and sorting/layout controls. This supports keeping saved reusable layouts distinct from edited projects.

## What we are applying

- A persistent workspace sidebar for Recent, Projects, and Layouts.
- A direct create action that asks only for card orientation and starting point, then opens the editor.
- Project previews generated from the card itself, paired with the name and last-edited date.
- A separate collection for reusable layouts, with an action to start a new project from one.
- Search across the current collection and empty states that explain the next useful action.

## What we are not copying

The project does not need Figma's team and collaboration surfaces, Adobe's media categories, community feed, promotional content, or product-specific file types. Those controls would add noise to a focused card-production workflow.

## Existing editor tokens retained

The workspace CSS carries forward the editor's core values from `public/editor.html`:

| Token | Value |
| --- | --- |
| Pasteboard | `#2B2B2B` |
| Chrome | `#3A3A3A` |
| Panel | `#424242` |
| Field | `#2E2E2E` |
| Selected / hover | `#535353` / `#4A4A4A` |
| Primary text / secondary text | `#D2D2D2` / `#9A9A9A` |
| Accent | `#5B4CF0` |
| Type | Inter, with JetBrains Mono for compact metadata |

The starter screen uses these values and the editor's compact, tool-oriented density. It adds only a small set of home-specific card and navigation rules; the card editor remains visually unchanged.
