export type DropReason =
  | 'consent' // consent not granted
  | 'sampling' // sampler rejected the event
  | 'rate_limit' // token bucket exhausted
  | 'quota' // server 429 quota signal
  | 'too_large' // single event exceeds server size limit
  | 'buffer_full' // maxBufferSize exceeded — oldest event evicted
  | 'client_dedup';
