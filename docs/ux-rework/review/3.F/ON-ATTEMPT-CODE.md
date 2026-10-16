**B — APPROVE `onCopyAttempt?: () => void`.**
Invoke the latest callback once per nonempty-blueprint `request()`, after advancing sequence/clearing success and before confirmation/write.
`confirm()` reuses that sequence and stored identity/snapshot; it never invokes the callback again.
App retires only its own failure message/action and snapshot; Cancel preserves the existing no-reveal/no-write behavior.
No additional public hook API is needed.