Why the signal has real value
A returning abandoner has already demonstrated purchase intent once — their same-session conversion rate is 2–4× higher than a cold visitor (well-established in e-commerce literature). Knowing this at $page_view time lets the intervention fire immediately rather than waiting to re-detect intent.

Why the SDK implementation is the wrong approach
The fundamental recall problem: the flag can only fire when checkout events are still sitting in the local IDB queue — meaning transport failed to deliver them. This represents a tiny slice of actual returning abandoners:

Scenario	Flag fires?	Correct?
User abandoned, events delivered to backend	❌ No	False negative
User abandoned, network was down, events still queued	✅ Yes	True positive
User abandoned on mobile, returns on desktop	❌ No	False negative (different IDB)
User abandoned in incognito, returns in normal	❌ No	False negative
User abandoned 30 days ago, stale queue in IDB	✅ Yes	False positive — stale, not meaningful
The result: high precision but ~5% recall. The backend has 100% recall because it has the full event history with identity stitching.

The correct implementation
This belongs entirely on the backend side of the prediction system:


The backend computes this once per session start and can push it back as a session property via the init response (if you have a session init API call), or stamp it on a first-party cookie on checkout_start. The SDK then reads the cookie — 5 lines, zero false positives, zero race conditions, full recall.