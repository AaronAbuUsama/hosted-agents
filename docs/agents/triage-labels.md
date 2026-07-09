# Triage Labels

The skills speak in terms of five canonical triage roles. This file maps those roles to the actual label strings used in this repo's issue tracker.

| Label in mattpocock/skills | Label in our tracker | Meaning                                  |
| -------------------------- | -------------------- | ---------------------------------------- |
| `needs-triage`             | `needs-triage`       | Maintainer needs to evaluate this issue  |
| `needs-info`               | `needs-info`         | Waiting on reporter for more information |
| `ready-for-agent`          | `ready-for-agent`    | Fully specified, ready for an AFK agent  |
| `ready-for-human`          | `ready-for-human`    | Requires human implementation            |
| `wontfix`                  | `wontfix`            | Will not be actioned                     |

When a skill mentions a role (e.g. "apply the AFK-ready triage label"), use the corresponding label string from this table.

> **Note:** these are the labels for *this repo's own engineering tracker* (where
> PRDs and dev tickets live). They are distinct from the **product's** issue-board
> gating labels (`ready for agent` / `human in the loop`) that the Coworker product
> reads on *end-user* repositories. Same idea, two different planes — don't conflate.

Edit the right-hand column to match whatever vocabulary you actually use.
