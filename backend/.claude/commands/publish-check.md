---
description: Check whether a QMI record is ready to publish
---
Call the `esperanza-ops` tool `get_record` for the QMI id/slug in $ARGUMENTS and report the
3-gate readiness: (1) has a house number/address, (2) linked to a complete floor plan,
(3) its pdf_renders are built/live. List which gates fail.
