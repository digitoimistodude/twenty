# Comment object provisioning (DEV-1143, DEV-1144)

Threaded comments are backed by a **custom object** created through Twenty's metadata
API (not source code) so it survives upgrades with zero rebase cost. This runbook
reproduces it on a fresh workspace. Run via the metadata API / MCP metadata tools
(`create_object_metadata`, `create_field_metadata`).

Named `recordComment` (not `comment`) on purpose: avoids colliding with any future
upstream standard `comment` object on upgrade. Display label is "Comment".

## Object

| prop | value |
|---|---|
| nameSingular | `recordComment` |
| namePlural | `recordComments` |
| labelSingular | Comment |
| labelPlural | Comments |
| icon | IconMessageCircle |
| description | Threaded discussion on a record (opportunity etc.). Author is createdBy; replies via parentComment. |

Automatic fields provide the rest: `id`, `createdAt`, `updatedAt`, `deletedAt`,
`createdBy` (ACTOR = comment author), `position`, `searchVector`, `name` (label id).

## Fields

| name | type | notes |
|---|---|---|
| `body` | RICH_TEXT | the comment text |
| `opportunity` | RELATION MANY_TO_ONE -> opportunity | reverse field `comments` |
| `person` | RELATION MANY_TO_ONE -> person | reverse field `comments` |
| `company` | RELATION MANY_TO_ONE -> company | reverse field `comments` |
| `parentComment` | RELATION MANY_TO_ONE -> recordComment (self) | reverse field `replies` -> threading |

Author = the automatic `createdBy` actor. Threading = `parentComment` / `replies`.

## Reverse relations created on existing objects

`opportunity.comments`, `person.comments`, `company.comments` (ONE_TO_MANY). These
auto-surface a Comments related section on those record pages; the polished threaded,
real-time tab is the frontend work (DEV-1146/1147), deployed separately.

## Reversal

Delete the `recordComment` object via the metadata API; the reverse relation fields go
with it. No data outside this object is touched.
