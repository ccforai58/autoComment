const test = require('node:test');
const assert = require('node:assert/strict');

const {
  shouldUseFastCommentFill,
  fillTextSequentially,
  buildHumanTypingPlan,
  buildSegmentedHumanTypingPlan,
  fillTextSegmented,
  fillEditableSegmented,
  getEffectiveSegmentedDelayScale,
  isLikelyWpDiscuzEditorCandidate
} = require('../lib/comment-fill-logic');

test('shouldUseFastCommentFill uses fast mode for explicit batch fill', () => {
  assert.equal(shouldUseFastCommentFill('short copy', { fast: true }), true);
});

test('shouldUseFastCommentFill uses fast mode for long generated comments', () => {
  assert.equal(shouldUseFastCommentFill('x'.repeat(300)), true);
  assert.equal(shouldUseFastCommentFill('x'.repeat(299)), false);
});

test('fillTextSequentially appends characters and preserves real href newline', async () => {
  const events = [];
  const input = {
    value: '',
    focusCalled: false,
    focus() {
      this.focusCalled = true;
    },
    dispatchEvent(event) {
      events.push({
        type: event.type,
        value: this.value
      });
      return true;
    }
  };
  const text = 'Before <a href="https://example.com/\n">Example</a>';

  const result = await fillTextSequentially(input, text, { delayMs: 0 });

  assert.equal(result.success, true);
  assert.equal(input.focusCalled, true);
  assert.equal(input.value, text);
  assert.equal(input.value.charCodeAt(input.value.indexOf('example.com/') + 'example.com/'.length), 10);
  assert.equal(events.filter((event) => event.type === 'input').length, text.length);
  assert.equal(events.some((event) => event.type === 'change'), true);
  assert.equal(events.at(-1).type, 'blur');
});

test('buildHumanTypingPlan creates nonzero human-normal delays with punctuation pauses', () => {
  const plan = buildHumanTypingPlan('Hi. There', {
    strategy: 'human-normal',
    random: () => 0
  });

  assert.equal(plan.strategy, 'human-normal');
  assert.equal(plan.steps.length, 9);
  assert.equal(plan.steps.every((step) => step.delayMs > 0), true);
  assert.ok(plan.steps[2].delayMs > plan.steps[0].delayMs);
  assert.ok(plan.totalDelayMs > 0);
});

test('fillTextSequentially returns human typing metrics and preserves href newline', async () => {
  const input = {
    value: '',
    focus() {},
    dispatchEvent() {
      return true;
    }
  };
  const text = 'Before <a href="https://example.com/\n">Example</a>';

  const result = await fillTextSequentially(input, text, {
    strategy: 'human-normal',
    delayScale: 0,
    random: () => 0
  });

  assert.equal(result.success, true);
  assert.equal(result.strategy, 'human-normal');
  assert.equal(result.chars, text.length);
  assert.equal(input.value, text);
  assert.equal(input.value.charCodeAt(input.value.indexOf('example.com/') + 'example.com/'.length), 10);
  assert.ok(result.avgDelayMs > 0);
});

test('buildSegmentedHumanTypingPlan types only anchor context and preserves href newline', () => {
  const prefix = 'A'.repeat(500);
  const suffix = 'Z'.repeat(500);
  const anchor = '<a href="https://example.com/\n">Example</a>';
  const text = `${prefix} before ${anchor} after ${suffix}`;

  const plan = buildSegmentedHumanTypingPlan(text, {
    typingStrategy: 'human-fast',
    contextChars: 5,
    maxDurationMs: 60000,
    random: () => 0
  });

  assert.equal(plan.strategy, 'segmented-human-fast');
  assert.equal(plan.anchorDetected, true);
  assert.equal(plan.hrefNewlinePreserved, true);
  assert.equal(plan.prefix.length > 450, true);
  assert.equal(plan.suffix.length > 450, true);
  assert.equal(plan.typed.includes(anchor), true);
  assert.equal(plan.typed.startsWith('fore '), true);
  assert.equal(plan.typed.endsWith(' afte'), true);
  assert.equal(plan.typed.length, anchor.length + 10);
  assert.equal(plan.typed.length < text.length, true);
  assert.equal(plan.totalDelayMs <= 60000, true);
});

test('fillTextSegmented directly appends outer text and types link segment only', async () => {
  const events = [];
  const input = {
    value: '',
    focus() {},
    dispatchEvent(event) {
      events.push({
        type: event.type,
        value: this.value
      });
      return true;
    }
  };
  const text = `${'A'.repeat(100)} <a href="https://example.com/\n">Example</a> ${'Z'.repeat(100)}`;

  const result = await fillTextSegmented(input, text, {
    typingStrategy: 'human-fast',
    contextChars: 5,
    delayScale: 0,
    random: () => 0
  });

  assert.equal(result.success, true);
  assert.equal(result.strategy, 'segmented-human-fast');
  assert.equal(result.anchorDetected, true);
  assert.equal(input.value, text);
  assert.equal(input.value.charCodeAt(input.value.indexOf('example.com/') + 'example.com/'.length), 10);
  assert.equal(events.filter((event) => event.type === 'input').length, result.typedChars + 2);
  assert.equal(result.typedChars < text.length, true);
  assert.equal(result.prefixChars > 90, true);
  assert.equal(result.suffixChars > 90, true);
});

test('fillEditableSegmented uses segmented typing for contenteditable comment editors', async () => {
  const events = [];
  const editor = {
    textContent: '',
    innerText: '',
    focusCalled: false,
    focus() {
      this.focusCalled = true;
    },
    dispatchEvent(event) {
      events.push({
        type: event.type,
        textContent: this.textContent
      });
      return true;
    }
  };
  const text = `${'A'.repeat(100)} <a href="https://example.com/\n">Example</a> ${'Z'.repeat(100)}`;

  const result = await fillEditableSegmented(editor, text, {
    typingStrategy: 'human-fast',
    contextChars: 5,
    delayScale: 0,
    random: () => 0
  });

  assert.equal(result.success, true);
  assert.equal(result.strategy, 'segmented-human-fast');
  assert.equal(result.anchorDetected, true);
  assert.equal(editor.focusCalled, true);
  assert.equal(editor.textContent, text);
  assert.equal(editor.innerText, text);
  assert.equal(events.filter((event) => event.type === 'input').length, result.typedChars + 2);
  assert.equal(result.typedChars < text.length, true);
});

test('getEffectiveSegmentedDelayScale disables waits for hidden or unfocused batch tabs', () => {
  assert.equal(getEffectiveSegmentedDelayScale({
    requestedDelayScale: 1,
    documentHidden: false,
    documentHasFocus: true
  }), 1);

  assert.equal(getEffectiveSegmentedDelayScale({
    requestedDelayScale: 1,
    documentHidden: true,
    documentHasFocus: true
  }), 0);

  assert.equal(getEffectiveSegmentedDelayScale({
    requestedDelayScale: 1,
    documentHidden: false,
    documentHasFocus: false
  }), 0);
});

test('isLikelyWpDiscuzEditorCandidate rejects wrapper containers without editable intent', () => {
  const wrapper = {
    getAttribute(name) {
      return name === 'contenteditable' ? null : '';
    },
    className: 'wpdiscuz-comment-text-wrap',
    id: '',
    closest() {
      return {};
    },
    querySelector(selector) {
      return selector === 'p, span, div' ? {} : null;
    }
  };

  const editor = {
    getAttribute(name) {
      return name === 'contenteditable' ? 'true' : '';
    },
    className: 'ql-editor',
    id: '',
    closest() {
      return {};
    },
    querySelector() {
      return null;
    }
  };

  assert.equal(isLikelyWpDiscuzEditorCandidate(wrapper), false);
  assert.equal(isLikelyWpDiscuzEditorCandidate(editor), true);
});
