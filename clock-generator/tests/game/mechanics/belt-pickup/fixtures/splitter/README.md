# Direct splitter pickup — queued

The user-provided [scaffold](scaffold.txt) is saved for a later mechanics investigation. No pickup timing has
been measured, no screenshot has been captured, and no simulator or Sidecar support is claimed by this fixture.

After the turbo merge PR is resolved, investigate direct pickup from the splitter, one controlled case at a
time. Start with turbo speed and record the actual pickup target, accessible transport lines, stack IDs and
per-tick hand changes. Then decide which port, lane preference, moving/backed-up and priority/filter controls
are needed to distinguish splitter behavior from ordinary belt supply. Do not enable a general test sweep or
change the production classifier merely because this scaffold exists.

When starting the case, capture its documentation JPEG with the existing screenshot script:

```bash
npm run screenshots -- --case=splitter
```
