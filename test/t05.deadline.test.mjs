import assert from 'node:assert/strict';
import test from 'node:test';
import { MAX_TIMER_DELAY_MS, scheduleDeepSeekDeadline } from '../src/deepseek-deadline.mjs';

test('a DeepSeek deadline schedules long remaining durations in runtime-safe slices', () => {
  const calls = [];
  const callback = () => {};
  const fakeTimer = (scheduled, delay) => {
    calls.push({ scheduled, delay });
    return { delay };
  };

  const handle = scheduleDeepSeekDeadline(callback, MAX_TIMER_DELAY_MS + 1, fakeTimer);

  assert.deepEqual(handle, { delay: MAX_TIMER_DELAY_MS });
  assert.deepEqual(calls, [{ scheduled: callback, delay: MAX_TIMER_DELAY_MS }]);
});

test('a DeepSeek deadline uses the minimum positive runtime delay once elapsed', () => {
  let delay;
  scheduleDeepSeekDeadline(() => {}, -10, (_callback, current) => { delay = current; });
  assert.equal(delay, 1);
});
