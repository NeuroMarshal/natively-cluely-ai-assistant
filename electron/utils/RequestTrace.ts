/**
 * RequestTrace keeps per-request stage timings in memory for local debugging
 * and tests. It never writes files and never sends data anywhere.
 */
export type RequestMilestone =
  | 'question_submitted'
  | 'what_to_answer_clicked'
  | 'transcript_window_loaded'
  | 'latest_question_extracted'
  | 'intent_classified'
  | 'answer_type_selected'
  | 'context_selected'
  | 'context_build_started'
  | 'context_build_completed'
  | 'prompt_built'
  | 'provider_request_started'
  | 'first_response_byte'
  | 'first_stream_chunk'
  | 'first_visible_text'
  | 'first_useful_token'
  | 'response_completed'
  | 'validation_started'
  | 'validation_completed'
  | 'validation_failed'
  | 'repair_used'
  | 'retry_used'
  | 'degraded_context'
  | 'ui_render_completed'
  | 'provider_timeout'
  | 'fallback_answer_used'
  | 'code_verify_started'
  | 'code_verify_skipped'
  | 'tests_extracted'
  | 'code_executed'
  | 'code_verify_passed'
  | 'code_verify_failed'
  | 'code_correction_used'
  | 'code_correction_error'
  | 'code_correction_reverified'
  | 'code_verify_error';

function monotonicNow(): number {
  try {
    const p: any = (globalThis as any).performance;
    if (p && typeof p.now === 'function') return p.now();
  } catch {
    // Date.now fallback below.
  }
  return Date.now();
}

export interface RequestTraceInit {
  source: 'manual' | 'what_to_answer' | 'system';
  sessionId?: string;
  modeId?: string;
  requestId?: string;
}

export class RequestTrace {
  private readonly t0: number;
  private readonly source: RequestTraceInit['source'];
  private readonly sessionId?: string;
  private readonly modeId?: string;
  readonly requestId: string;
  private readonly timings: Record<string, number> = {};
  private firstUsefulEmitted = false;
  private static counter = 0;

  constructor(init: RequestTraceInit) {
    this.t0 = monotonicNow();
    this.source = init.source;
    this.sessionId = init.sessionId;
    this.modeId = init.modeId;
    this.requestId = init.requestId ?? `req_${Math.round(this.t0)}_${++RequestTrace.counter}`;
  }

  elapsedMs(): number {
    return Math.max(0, Math.round(monotonicNow() - this.t0));
  }

  mark(milestone: RequestMilestone, props?: Record<string, unknown>): number {
    void props;
    const elapsed = this.elapsedMs();
    if (!(milestone in this.timings)) this.timings[milestone] = elapsed;
    return elapsed;
  }

  markFirstUseful(props?: Record<string, unknown>): boolean {
    if (this.firstUsefulEmitted) return false;
    this.firstUsefulEmitted = true;
    this.mark('first_useful_token', props);
    return true;
  }

  hasFirstUseful(): boolean {
    return this.firstUsefulEmitted;
  }

  snapshot(): Record<string, number> {
    return { ...this.timings };
  }

  finish(extra?: Record<string, unknown>): void {
    const enabled = (() => {
      try {
        return process.env.MEASURE_LATENCY === 'true' || process.env.REQUEST_TRACE === 'true';
      } catch {
        return false;
      }
    })();
    if (!enabled) return;

    const entries = Object.entries(this.timings).sort((a, b) => a[1] - b[1]);
    const total = this.elapsedMs();
    const lines: string[] = [];
    lines.push(`\n-- REQUEST TRACE (${this.source}, req=${this.requestId}) total ${total}ms`);
    if (this.sessionId) lines.push(`session=${this.sessionId}`);
    if (this.modeId) lines.push(`mode=${this.modeId}`);
    let prev = 0;
    for (const [name, at] of entries) {
      lines.push(`+${String(at - prev).padStart(5)}ms @${String(at).padStart(6)}ms ${name}`);
      prev = at;
    }
    if (extra && Object.keys(extra).length) lines.push(JSON.stringify(extra));
    console.log(lines.join('\n'));
  }
}
