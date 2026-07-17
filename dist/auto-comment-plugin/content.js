(function () {
  // ====== 原有自动填表功能 ======
  // 默认值设为空，用户需要在扩展选项中配置
  const DEFAULT_EMAIL = '';
  const DEFAULT_PASSWORD = '';
  const DEFAULT_USERNAME = '';

  async function fillInputs() {
    const WEBSITE = await getWebsiteUrl();
    const userProfile = await getUserProfile();
    const EMAIL = userProfile.email;
    const USERNAME = userProfile.name;
    const PASSWORD = userProfile.password;
    const allInputs = Array.from(document.querySelectorAll('input'));
    const allTextareas = Array.from(document.querySelectorAll('textarea'));

    // 填邮箱（全局优先填第一个看起来像 Email 的输入框）
    const emailCandidates = allInputs.filter((input) => {
      const type = (input.type || '').toLowerCase();
      const name = (input.name || '').toLowerCase();
      const id = (input.id || '').toLowerCase();
      const placeholder = (input.placeholder || '').toLowerCase();

      if (type === 'hidden') return false;

      if (type === 'email') return true;

      const keywords = ['email', 'e-mail', 'mail'];
      return keywords.some((k) => name.includes(k) || id.includes(k) || placeholder.includes(k));
    });

    if (emailCandidates.length > 0) {
      const emailInput = emailCandidates[0];
      setValue(emailInput, EMAIL);
    }

    // 填用户名（尽量匹配"用户名 / 账号 / 昵称 / login / username"等字段）
    const usernameCandidates = allInputs.filter((input) => {
      const type = (input.type || '').toLowerCase();
      if (type === 'email' || type === 'password' || type === 'checkbox' || type === 'radio') {
        return false;
      }

      const name = (input.name || '').toLowerCase();
      const id = (input.id || '').toLowerCase();
      const placeholder = (input.placeholder || '').toLowerCase();
      const text = `${name} ${id} ${placeholder}`;

      const keywords = [
        'user',
        'username',
        'account',
        'login',
        'nick',
        'nickname',
        'handle',
        '用户名',
        '账号',
        '帐户',
        '登录名',
        '昵称'
      ];

      return keywords.some((k) => text.includes(k));
    });

    if (usernameCandidates.length > 0) {
      const usernameInput = usernameCandidates[0];
      setValue(usernameInput, USERNAME);
    }

    // 填密码（通常有两个：密码和确认密码）
    const passwordInputs = allInputs.filter(
      (input) => (input.type || '').toLowerCase() === 'password'
    );

    if (passwordInputs.length > 0) {
      passwordInputs.forEach((input) => {
        setValue(input, PASSWORD);
      });
    }

    // ====== 针对"评论表单"的增强逻辑：自动填 Name / Email / Website ======
    const commentForms = new Set();
    allTextareas.forEach((ta) => {
      const name = (ta.name || '').toLowerCase();
      const id = (ta.id || '').toLowerCase();
      const placeholder = (ta.placeholder || '').toLowerCase();
      const text = `${name} ${id} ${placeholder}`;
      const keywords = [
        'comment',
        'comentario',
        'reply',
        'respuesta',
        'message',
        'mensaje',
        'review',
        'reseña',
        'feedback',
        'opinion',
        'opinión',
        'commenttext',
        '留言',
        '评论',
        '回复'
      ];
      if (keywords.some((k) => text.includes(k))) {
        const form = ta.form || (ta.closest && ta.closest('form'));
        if (form) {
          commentForms.add(form);
        }
      }
    });

    if (commentForms.size === 0) {
      const forms = Array.from(document.querySelectorAll('form'));
      forms.forEach((form) => {
        const text = safeLowerStringLocal(form.textContent || '');
        const className = safeLowerStringLocal(form.className || '');
        const id = safeLowerStringLocal(form.id || '');

        const keywords = [
          'deja una respuesta',
          'deja un comentario',
          'tu dirección de correo electrónico no será publicada',
          'comentario *',
          'leave a reply',
          'leave a comment',
          'post comment',
          'submit comment',
          'reply',
          'respond',
          '评论',
          '留言',
          '回复'
        ];

        const wpClassNames = ['comment-form', 'commentform', 'respond', 'comment-respond'];

        if (keywords.some((k) => text.includes(k)) ||
            wpClassNames.some(c => className.includes(c) || id.includes(c))) {
          commentForms.add(form);
        }
      });
    }

    if (commentForms.size === 0) {
      const commentAreas = document.querySelectorAll('#comments, .comments, .comment-section, #respond, .respond, .reply');
      commentAreas.forEach(area => {
        const form = area.closest('form');
        if (form) {
          commentForms.add(form);
        }
      });
    }

    if (commentForms.size > 0) {
      commentForms.forEach((form) => {
        const formInputs = Array.from(form.querySelectorAll('input'));

        const nameInput = formInputs.find((input) => {
          const type = (input.type || '').toLowerCase();
          if (type === 'email' || type === 'password' || type === 'checkbox' || type === 'radio') {
            return false;
          }
          const name = (input.name || '').toLowerCase();
          const id = (input.id || '').toLowerCase();
          const placeholder = (input.placeholder || '').toLowerCase();
          const text = `${name} ${id} ${placeholder}`;
          const keywords = [
            'name',
            'your-name',
            'author',
            'nickname',
            'nick',
            'fullname',
            'full-name',
            'display-name',
            'contact',
            '联系人',
            '姓名',
            '名字',
            '称呼',
            'nombre'
          ];
          return keywords.some((k) => text.includes(k));
        });
        if (nameInput) {
          setValue(nameInput, USERNAME);
        }

        const emailInputInForm = formInputs.find((input) => {
          const type = (input.type || '').toLowerCase();
          const name = (input.name || '').toLowerCase();
          const id = (input.id || '').toLowerCase();
          const placeholder = (input.placeholder || '').toLowerCase();

          if (type === 'hidden' || type === 'password' || type === 'checkbox' || type === 'radio') {
            return false;
          }

          if (type === 'email') return true;

          const text = `${name} ${id} ${placeholder}`;
          const keywords = ['email', 'e-mail', 'mail'];
          return keywords.some((k) => text.includes(k));
        });
        if (emailInputInForm) {
          setValue(emailInputInForm, EMAIL);
        }

        const websiteInput = formInputs.find((input) => {
          const type = (input.type || '').toLowerCase();
          if (type === 'email' || type === 'password' || type === 'checkbox' || type === 'radio') {
            return false;
          }
          const name = (input.name || '').toLowerCase();
          const id = (input.id || '').toLowerCase();
          const placeholder = (input.placeholder || '').toLowerCase();
          const text = `${name} ${id} ${placeholder}`;
          const keywords = [
            'website',
            'site',
            'homepage',
            'home-page',
            'blog',
            'url',
            'link',
            'web',
            '网站',
            '网址',
            '站点'
          ];
          return keywords.some((k) => text.includes(k));
        });
        if (websiteInput && WEBSITE) {
          setValue(websiteInput, WEBSITE);
        }
      });
    }
  }

  function getDomInputElement(input) {
    if (!input) return null;
    if (typeof input.dispatchEvent === 'function') return input;
    if (input._realElement && typeof input._realElement.dispatchEvent === 'function') return input._realElement;
    return null;
  }

  function safeDispatchInputEvent(input, event) {
    const el = getDomInputElement(input);
    if (!el) {
      console.warn('[AutoComment] skip dispatch event: target is not a DOM element');
      return false;
    }
    el.dispatchEvent(event);
    return true;
  }

  function setValue(input, value) {
    if (input && input._isWpDiscuz && input._realElement) {
      setValueForEditableDiv(input._realElement, value);
      return;
    }
    const descriptor = Object.getOwnPropertyDescriptor(
      Object.getPrototypeOf(input),
      'value'
    );
    if (descriptor && descriptor.set) {
      descriptor.set.call(input, value);
    } else {
      input.value = value;
    }

    // 标准 input / change 事件（覆盖大多数场景）
    safeDispatchInputEvent(input, new Event('input', { bubbles: true, cancelable: true }));
    safeDispatchInputEvent(input, new Event('change', { bubbles: true, cancelable: true }));

    // React 16+ / Vue 需要 InputEvent 并带 inputType
    try {
      const inputEvent = new InputEvent('input', {
        bubbles: true,
        cancelable: true,
        inputType: 'insertText',
        data: value
      });
      safeDispatchInputEvent(input, inputEvent);
    } catch (_) {}

    // 某些主题在 blur 时才触发验证（如 Akismet、WP Math Latex 等插件）
    safeDispatchInputEvent(input, new FocusEvent('blur', { bubbles: true, relatedTarget: null }));
  }

  function shouldUseFastCommentFill(text, options = {}) {
    if (options.fast === true) return true;
    return String(text || '').length >= 300;
  }

  function getEffectiveSegmentedDelayScaleLocal(options = {}) {
    const requested = options.requestedDelayScale === undefined
      ? 1
      : Math.max(0, Number(options.requestedDelayScale) || 0);
    if (options.documentHidden === true || options.documentHasFocus === false) {
      return 0;
    }
    return requested;
  }

  function setValueDirect(input, value) {
    if (!input) return false;
    if (input._isWpDiscuz && input._realElement) {
      setValueForEditableDiv(input._realElement, value);
      return true;
    }

    try {
      input.focus && input.focus();
    } catch (_) {}

    const descriptor = Object.getOwnPropertyDescriptor(
      Object.getPrototypeOf(input),
      'value'
    );
    if (descriptor && descriptor.set) {
      descriptor.set.call(input, value);
    } else {
      input.value = value;
    }

    safeDispatchInputEvent(input, new Event('input', { bubbles: true, cancelable: true }));
    safeDispatchInputEvent(input, new Event('change', { bubbles: true, cancelable: true }));
    try {
      safeDispatchInputEvent(input, new InputEvent('input', {
        bubbles: true,
        cancelable: true,
        inputType: 'insertText',
        data: value
      }));
    } catch (_) {}
    safeDispatchInputEvent(input, new FocusEvent('blur', { bubbles: true, relatedTarget: null }));
    return getCommentFieldText(input).length >= 5;
  }

  // ──────────────────────────────────────────────────────────────
  //  处理 contenteditable div（如 wpDiscuz 评论框）
  // ──────────────────────────────────────────────────────────────
  function setValueForEditableDiv(div, value) {
    if (!div || div.getAttribute('contenteditable') !== 'true') return;
    
    console.log('[AutoComment] 填充 wpDiscuz 编辑器');
    
    // 先清空内容
    div.focus();
    document.execCommand('selectAll', false, null);
    document.execCommand('delete', false, null);
    
    // 设置新内容
    div.textContent = value;
    
    // 触发输入事件
    div.dispatchEvent(new Event('input', { bubbles: true, cancelable: true }));
    div.dispatchEvent(new Event('change', { bubbles: true, cancelable: true }));
    
    // 尝试触发 keydown/keyup 事件
    try {
      div.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true }));
      div.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, cancelable: true }));
    } catch (_) {}
    
    // 触发 blur
    div.dispatchEvent(new FocusEvent('blur', { bubbles: true, relatedTarget: null }));
    
    console.log('[AutoComment] wpDiscuz 编辑器填充完成，长度:', value.length);
  }

  // ──────────────────────────────────────────────────────────────
  //  强化版填值：先聚焦 → 清空 → 按字符填入 → 触发完整事件链
  //  适用于 WordPress 中使用 React/Vue 或字符级监听的主题
  // ──────────────────────────────────────────────────────────────
  async function fillEditableDivSegmentedHumanLike(div, text, options = {}) {
    const value = String(text || '');
    const startedAt = Date.now();
    const plan = buildSegmentedHumanTypingPlanLocal(value, options);
    const delayScale = getEffectiveSegmentedDelayScaleLocal({
      requestedDelayScale: options.delayScale,
      documentHidden: typeof document !== 'undefined' && document.visibilityState === 'hidden',
      documentHasFocus: typeof document === 'undefined' || typeof document.hasFocus !== 'function' ? true : document.hasFocus()
    });

    if (typeof div.focus === 'function') {
      div.focus();
    }

    const assign = (nextValue) => {
      div.textContent = nextValue;
      div.innerText = nextValue;
    };

    let currentValue = plan.prefix;
    assign(currentValue);
    safeDispatchInputEvent(div, new Event('input', { bubbles: true, cancelable: true }));

    for (const step of plan.steps) {
      currentValue += step.ch;
      assign(currentValue);
      try {
        safeDispatchInputEvent(div, new InputEvent('input', {
          bubbles: true,
          cancelable: true,
          inputType: 'insertText',
          data: step.ch
        }));
      } catch (_) {
        safeDispatchInputEvent(div, new Event('input', { bubbles: true, cancelable: true }));
      }
      const waitMs = Math.round(step.delayMs * delayScale);
      if (waitMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, waitMs));
      }
    }

    currentValue += plan.suffix;
    assign(currentValue);
    safeDispatchInputEvent(div, new Event('input', { bubbles: true, cancelable: true }));
    safeDispatchInputEvent(div, new Event('change', { bubbles: true, cancelable: true }));
    try {
      safeDispatchInputEvent(div, new FocusEvent('blur', { bubbles: true, relatedTarget: null }));
    } catch (_) {
      safeDispatchInputEvent(div, new Event('blur', { bubbles: true, cancelable: true }));
    }

    return {
      success: (div.textContent || '').trim().length >= 5,
      chars: Array.from(value).length,
      prefixChars: plan.prefix.length,
      typedChars: plan.steps.length,
      suffixChars: plan.suffix.length,
      durationMs: Date.now() - startedAt,
      plannedDelayMs: plan.totalDelayMs,
      avgDelayMs: plan.avgDelayMs,
      maxDurationMs: plan.maxDurationMs,
      strategy: plan.strategy,
      anchorDetected: plan.anchorDetected,
      hrefNewlinePreserved: plan.hrefNewlinePreserved,
      delayCapScale: plan.delayCapScale,
      effectiveDelayScale: delayScale,
      documentHidden: typeof document !== 'undefined' && document.visibilityState === 'hidden',
      documentHasFocus: typeof document === 'undefined' || typeof document.hasFocus !== 'function' ? true : document.hasFocus(),
      filledLength: (div.textContent || '').trim().length
    };
  }

  function setValueRobust(input, value) {
    if (input && input._isWpDiscuz && input._realElement) {
      setValueForEditableDiv(input._realElement, value);
      return;
    }
    console.log('进入setValueRobust方法');
    try {
      input.focus();
      input.select && input.select();
    } catch (_) {}

    // 模拟逐字输入（最高兼容性）
    console.log('开始模拟逐字输入');
    for (const ch of value) {
      if (input.value && input.value.length > 0) {
        // 用 setValue 方法清空已有内容
        const desc = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(input), 'value');
        if (desc && desc.set) {
          desc.set.call(input, '');
        } else {
          input.value = '';
        }
      }
      const prevVal = input.value;
      // 追加字符
      const desc2 = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(input), 'value');
      if (desc2 && desc2.set) {
        desc2.set.call(input, prevVal + ch);
      } else {
        input.value = prevVal + ch;
      }
      safeDispatchInputEvent(input, new Event('input', { bubbles: true, cancelable: true }));
    }

    // 再触发一次完整赋值 + 事件
    console.log('再触发一次完整赋值 + 事件');
    const desc3 = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(input), 'value');
    if (desc3 && desc3.set) {
      desc3.set.call(input, value);
    } else {
      input.value = value;
    }
    safeDispatchInputEvent(input, new Event('input', { bubbles: true, cancelable: true }));
    safeDispatchInputEvent(input, new Event('change', { bubbles: true, cancelable: true }));

    try {
      safeDispatchInputEvent(input, new InputEvent('input', {
        bubbles: true, cancelable: true, inputType: 'insertText', data: value
      }));
    } catch (_) {}
    safeDispatchInputEvent(input, new FocusEvent('blur', { bubbles: true, relatedTarget: null }));
    safeDispatchInputEvent(input, new Event('change', { bubbles: true }));
  }

  // ====== AI 生成配置 ======

  function getCommentFieldText(field) {
    if (!field) return '';
    if (field._isWpDiscuz && field._realElement) {
      return (field._realElement.textContent || '').trim();
    }
    if (typeof field.value === 'string') {
      return field.value.trim();
    }
    if (field.textContent) {
      return field.textContent.trim();
    }
    return '';
  }

  function getReusableCopyKey(text) {
    const value = String(text || '');
    return `${value.length}:${value.slice(0, 32)}:${value.slice(-32)}`;
  }

  async function getBatchAiReuseState() {
    if (typeof chrome === 'undefined' || !chrome.storage) return {};
    return new Promise((resolve) => {
      chrome.storage.local.get([AI_REUSE_STATE_STORAGE_KEY], (data) => {
        const state = data && data[AI_REUSE_STATE_STORAGE_KEY];
        resolve(state && typeof state === 'object' ? state : {});
      });
    });
  }

  async function setBatchAiReuseState(patch) {
    if (typeof chrome === 'undefined' || !chrome.storage) return;
    const previous = await getBatchAiReuseState();
    await new Promise((resolve) => {
      chrome.storage.local.set({
        [AI_REUSE_STATE_STORAGE_KEY]: {
          ...previous,
          ...(patch || {}),
          updatedAt: Date.now()
        }
      }, resolve);
    });
  }

  async function rememberSuccessfulBatchAiCopy(text, source) {
    const value = String(text || '').trim();
    if (!isUsableGeneratedCopy(value)) return;
    await setBatchAiReuseState({
      latestCopy: {
        text: value,
        key: getReusableCopyKey(value),
        sourceUrl: source && source.url ? source.url : location.href,
        urlIndex: source && source.urlIndex !== undefined ? source.urlIndex : null,
        savedAt: Date.now()
      },
      previousReuseKey: '',
      previousReuseCount: 0,
      warning: '',
      firstGenerationFailed: false
    });
  }

  function buildAiReuseStateLocal(input) {
    const source = input && typeof input === 'object' ? input : {};
    if (source.aiOk === true) return { action: 'fresh', reuseCount: 0, reuseKey: '', warning: '' };
    const reusableCopy = source.reusableCopy && typeof source.reusableCopy === 'object' && isUsableGeneratedCopy(source.reusableCopy.text)
      ? {
        text: String(source.reusableCopy.text),
        key: String(source.reusableCopy.key || getReusableCopyKey(source.reusableCopy.text)),
        sourceUrl: source.reusableCopy.sourceUrl || '',
        urlIndex: source.reusableCopy.urlIndex
      }
      : null;
    if (!reusableCopy) return { action: 'fail_first_generation', reusableCopy: null, reuseCount: 0, reuseKey: '', warning: 'first_generation_failed' };
    const previousReuseKey = String(source.previousReuseKey || '');
    const previousReuseCount = Number(source.previousReuseCount || 0);
    const reuseCount = previousReuseKey === reusableCopy.key ? Math.max(0, previousReuseCount) + 1 : 1;
    return {
      action: 'reuse',
      reusableCopy,
      reuseKey: reusableCopy.key,
      reuseCount,
      warning: reuseCount >= 3 ? 'same_copy_reused_3_times' : ''
    };
  }

  async function getBatchAiCopyAfterGenerationFailure(error, source) {
    const state = await getBatchAiReuseState();
    const decision = buildAiReuseStateLocal({
      aiOk: false,
      reusableCopy: state.latestCopy || null,
      previousReuseKey: state.previousReuseKey || '',
      previousReuseCount: state.previousReuseCount || 0
    });

    if (decision.action === 'fail_first_generation') {
      await setBatchAiReuseState({
        firstGenerationFailed: true,
        warning: 'first_generation_failed',
        lastError: error && error.message ? error.message : String(error || 'AI generation failed')
      });
      logBatchSubmit('ai.first_generation_warning_shown', {
        error: error && error.message ? error.message : String(error || 'AI generation failed')
      });
      return decision;
    }

    await setBatchAiReuseState({
      firstGenerationFailed: false,
      warning: decision.warning,
      previousReuseKey: decision.reuseKey,
      previousReuseCount: decision.reuseCount,
      lastReuseSourceUrl: decision.reusableCopy.sourceUrl || '',
      lastReuseSourceIndex: decision.reusableCopy.urlIndex,
      lastReuseTargetUrl: source && source.url ? source.url : location.href,
      lastReuseTargetIndex: source && source.urlIndex !== undefined ? source.urlIndex : null
    });
    logBatchSubmit('ai.generate_failed_reuse_done', {
      reusedContentLength: decision.reusableCopy.text.length,
      reuseSourceUrl: decision.reusableCopy.sourceUrl || '',
      reuseSourceIndex: decision.reusableCopy.urlIndex,
      reuseCount: decision.reuseCount,
      warning: decision.warning
    });
    if (decision.warning) {
      logBatchSubmit('ai.reuse_warning_shown', {
        warning: decision.warning,
        reuseCount: decision.reuseCount
      });
    }
    return decision;
  }

  function getCommentFieldHtml(field) {
    if (!field) return '';
    if (field._isWpDiscuz && field._realElement) {
      return (field._realElement.innerHTML || field._realElement.textContent || '').trim();
    }
    if (typeof field.value === 'string') {
      return field.value.trim();
    }
    if (field.innerHTML) {
      return field.innerHTML.trim();
    }
    return getCommentFieldText(field);
  }

  function fillSpecificCommentTextarea(commentTextarea, commentText, options = {}) {
    if (!commentTextarea || !commentText) return false;
    if (commentTextarea._isWpDiscuz && commentTextarea._realElement) {
      setValueForEditableDiv(commentTextarea._realElement, commentText);
    } else if (shouldUseFastCommentFill(commentText, options)) {
      setValueDirect(commentTextarea, commentText);
    } else {
      setValueRobust(commentTextarea, commentText);
      if (getCommentFieldText(commentTextarea).length < 5) {
        setValue(commentTextarea, commentText);
      }
    }
    const filledText = getCommentFieldText(commentTextarea);
    console.log('[AutoComment] targeted comment fill result:', {
      success: filledText.length >= 5,
      length: filledText.length,
      textareaName: commentTextarea.name,
      textareaId: commentTextarea.id
    });
    return filledText.length >= 5;
  }

  const HUMAN_TYPING_PROFILES_LOCAL = {
    'human-fast': {
      baseMin: 8,
      baseMax: 30,
      punctuationMin: 60,
      punctuationMax: 160,
      newlineMin: 120,
      newlineMax: 320
    },
    'human-normal': {
      baseMin: 25,
      baseMax: 90,
      punctuationMin: 120,
      punctuationMax: 350,
      newlineMin: 300,
      newlineMax: 900
    },
    'human-careful': {
      baseMin: 60,
      baseMax: 180,
      punctuationMin: 500,
      punctuationMax: 1500,
      newlineMin: 800,
      newlineMax: 2000
    }
  };

  function normalizeTypingStrategyLocal(strategy) {
    return HUMAN_TYPING_PROFILES_LOCAL[strategy] ? strategy : 'human-normal';
  }

  function randomBetweenLocal(min, max) {
    return Math.round(min + (max - min) * Math.random());
  }

  function getHumanTypingDelayLocal(ch, profile) {
    if (ch === '\n' || ch === '\r') {
      return randomBetweenLocal(profile.newlineMin, profile.newlineMax);
    }
    if (/[.!?,;:\u3002\uff0c\uff01\uff1f\uff1b\uff1a]/.test(ch)) {
      return randomBetweenLocal(profile.punctuationMin, profile.punctuationMax);
    }
    return randomBetweenLocal(profile.baseMin, profile.baseMax);
  }

  function buildHumanTypingPlanLocal(text, options = {}) {
    const strategy = normalizeTypingStrategyLocal(options.strategy || options.typingStrategy);
    const profile = HUMAN_TYPING_PROFILES_LOCAL[strategy];
    const value = String(text || '');
    const steps = Array.from(value).map((ch) => ({
      ch,
      delayMs: getHumanTypingDelayLocal(ch, profile)
    }));
    const totalDelayMs = steps.reduce((sum, step) => sum + step.delayMs, 0);
    return {
      strategy,
      steps,
      totalDelayMs,
      avgDelayMs: steps.length > 0 ? Math.round(totalDelayMs / steps.length) : 0
    };
  }

  function findPromotedTextRangeLocal(text, options = {}) {
    const value = String(text || '');
    const anchorMatch = /<a\b[\s\S]*?<\/a>/i.exec(value);
    if (anchorMatch) {
      return {
        start: anchorMatch.index,
        end: anchorMatch.index + anchorMatch[0].length,
        anchorDetected: true,
        hrefNewlinePreserved: /href\s*=\s*["'][\s\S]*?\n[\s\S]*?["']/i.test(anchorMatch[0])
      };
    }

    const promotionUrl = String(options.promotionUrl || '').trim();
    if (promotionUrl) {
      const normalizedUrl = promotionUrl.replace(/\/+$/, '');
      const directIndex = value.indexOf(promotionUrl);
      const normalizedIndex = normalizedUrl && normalizedUrl !== promotionUrl ? value.indexOf(normalizedUrl) : -1;
      const index = directIndex >= 0 ? directIndex : normalizedIndex;
      if (index >= 0) {
        const matched = directIndex >= 0 ? promotionUrl : normalizedUrl;
        return {
          start: index,
          end: index + matched.length,
          anchorDetected: false,
          hrefNewlinePreserved: false
        };
      }
    }

    const urlMatch = /https?:\/\/[^\s"'<>]+/i.exec(value);
    if (urlMatch) {
      return {
        start: urlMatch.index,
        end: urlMatch.index + urlMatch[0].length,
        anchorDetected: false,
        hrefNewlinePreserved: false
      };
    }

    return {
      start: 0,
      end: value.length,
      anchorDetected: false,
      hrefNewlinePreserved: false
    };
  }

  function buildSegmentedHumanTypingPlanLocal(text, options = {}) {
    const value = String(text || '');
    const contextChars = Math.max(0, Math.round(Number(options.contextChars ?? 5) || 0));
    const maxDurationMs = Math.max(0, Math.round(Number(options.maxDurationMs ?? 60000) || 0));
    const range = findPromotedTextRangeLocal(value, options);
    const typedStart = Math.max(0, range.start - contextChars);
    const typedEnd = Math.min(value.length, range.end + contextChars);
    const prefix = value.slice(0, typedStart);
    const typed = value.slice(typedStart, typedEnd);
    const suffix = value.slice(typedEnd);
    const basePlan = buildHumanTypingPlanLocal(typed, options);
    const capScale = maxDurationMs > 0 && basePlan.totalDelayMs > maxDurationMs
      ? maxDurationMs / basePlan.totalDelayMs
      : 1;
    const steps = basePlan.steps.map((step) => ({
      ch: step.ch,
      delayMs: Math.round(step.delayMs * capScale)
    }));
    const totalDelayMs = steps.reduce((sum, step) => sum + step.delayMs, 0);
    return {
      strategy: `segmented-${basePlan.strategy}`,
      baseStrategy: basePlan.strategy,
      prefix,
      typed,
      suffix,
      steps,
      totalDelayMs,
      avgDelayMs: steps.length > 0 ? Math.round(totalDelayMs / steps.length) : 0,
      maxDurationMs,
      delayCapScale: capScale,
      anchorDetected: range.anchorDetected,
      hrefNewlinePreserved: range.hrefNewlinePreserved,
      typedStart,
      typedEnd
    };
  }

  async function fillSpecificCommentTextareaHumanLike(commentTextarea, commentText, options = {}) {
    const text = String(commentText || '');
    const startedAt = Date.now();
    if (!commentTextarea || !text) {
      return {
        success: false,
        chars: 0,
        durationMs: Date.now() - startedAt,
        plannedDelayMs: 0,
        avgDelayMs: 0,
        strategy: normalizeTypingStrategyLocal(options.strategy || options.typingStrategy),
        error: !commentTextarea ? 'missing_textarea' : 'empty_text'
      };
    }

    if (commentTextarea._isWpDiscuz && commentTextarea._realElement) {
      const result = await fillEditableDivSegmentedHumanLike(commentTextarea._realElement, text, options);
      const filledText = getCommentFieldText(commentTextarea);
      return {
        ...result,
        success: filledText.length >= 5,
        filledLength: filledText.length
      };
    }

    const plan = buildSegmentedHumanTypingPlanLocal(text, options);
    const delayScale = getEffectiveSegmentedDelayScaleLocal({
      requestedDelayScale: options.delayScale,
      documentHidden: typeof document !== 'undefined' && document.visibilityState === 'hidden',
      documentHasFocus: typeof document === 'undefined' || typeof document.hasFocus !== 'function' ? true : document.hasFocus()
    });
    if (typeof commentTextarea.focus === 'function') {
      commentTextarea.focus();
    }

    const desc = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(commentTextarea), 'value');
    const setNativeValue = (value) => {
      if (desc && desc.set) {
        desc.set.call(commentTextarea, value);
      } else {
        commentTextarea.value = value;
      }
    };

    setNativeValue(plan.prefix);
    safeDispatchInputEvent(commentTextarea, new Event('input', { bubbles: true, cancelable: true }));

    let currentValue = plan.prefix;
    for (const step of plan.steps) {
      currentValue += step.ch;
      setNativeValue(currentValue);
      try {
        safeDispatchInputEvent(commentTextarea, new InputEvent('input', {
          bubbles: true,
          cancelable: true,
          inputType: 'insertText',
          data: step.ch
        }));
      } catch (_) {
        safeDispatchInputEvent(commentTextarea, new Event('input', { bubbles: true, cancelable: true }));
      }
      const waitMs = Math.round(step.delayMs * delayScale);
      if (waitMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, waitMs));
      }
    }

    currentValue += plan.suffix;
    setNativeValue(currentValue);
    safeDispatchInputEvent(commentTextarea, new Event('input', { bubbles: true, cancelable: true }));
    safeDispatchInputEvent(commentTextarea, new Event('change', { bubbles: true, cancelable: true }));
    try {
      safeDispatchInputEvent(commentTextarea, new FocusEvent('blur', { bubbles: true, relatedTarget: null }));
    } catch (_) {
      safeDispatchInputEvent(commentTextarea, new Event('blur', { bubbles: true, cancelable: true }));
    }

    const filledText = getCommentFieldText(commentTextarea);
    return {
      success: filledText.length >= 5,
      chars: Array.from(text).length,
      prefixChars: plan.prefix.length,
      typedChars: plan.steps.length,
      suffixChars: plan.suffix.length,
      durationMs: Date.now() - startedAt,
      plannedDelayMs: plan.totalDelayMs,
      avgDelayMs: plan.avgDelayMs,
      maxDurationMs: plan.maxDurationMs,
      strategy: plan.strategy,
      anchorDetected: plan.anchorDetected,
      hrefNewlinePreserved: plan.hrefNewlinePreserved,
      delayCapScale: plan.delayCapScale,
      effectiveDelayScale: delayScale,
      documentHidden: typeof document !== 'undefined' && document.visibilityState === 'hidden',
      documentHasFocus: typeof document === 'undefined' || typeof document.hasFocus !== 'function' ? true : document.hasFocus(),
      filledLength: filledText.length
    };
  }

  function isLikelyWpDiscuzEditorCandidateLocal(editor) {
    if (!editor || typeof editor.getAttribute !== 'function') return false;
    return editor.getAttribute('contenteditable') === 'true';
  }

  function detectEmbeddedCommentSignalLocal() {
    const iframeSelectors = [
      'iframe[src*="comment" i]',
      'iframe[src*="blogger" i]',
      'iframe[src*="blogspot" i]',
      'iframe[src*="disqus" i]',
      'iframe[id*="comment" i]',
      'iframe[class*="comment" i]',
      'iframe[title*="comment" i]'
    ];
    const linkSelectors = [
      'a[href*="comment" i]',
      'a[href*="respond" i]',
      'button',
      '[role="button"]'
    ];
    const textSignals = [
      'add comment',
      'post a comment',
      'leave a comment',
      'leave a reply',
      'reply',
      'respond'
    ];
    const iframe = iframeSelectors.map((selector) => {
      try {
        return document.querySelector(selector);
      } catch (_) {
        return null;
      }
    }).find(Boolean);
    if (iframe) {
      return {
        found: true,
        reason: 'comment_iframe',
        tag: iframe.tagName,
        id: iframe.id || '',
        className: iframe.className || '',
        src: iframe.getAttribute('src') || ''
      };
    }

    for (const selector of linkSelectors) {
      let nodes = [];
      try {
        nodes = Array.from(document.querySelectorAll(selector));
      } catch (_) {
        nodes = [];
      }
      for (const node of nodes) {
        const text = String(node.textContent || node.getAttribute('aria-label') || node.getAttribute('title') || '').toLowerCase().replace(/\s+/g, ' ').trim();
        const href = String(node.getAttribute && node.getAttribute('href') || '').toLowerCase();
        if (textSignals.some((signal) => text.includes(signal) || href.includes(signal.replace(/\s+/g, '-')) || href.includes(signal.replace(/\s+/g, '')))) {
          return {
            found: true,
            reason: 'comment_action',
            tag: node.tagName,
            id: node.id || '',
            className: node.className || '',
            text: text.slice(0, 120),
            href
          };
        }
      }
    }

    return { found: false, reason: '' };
  }

  function classifyInitialCommentFormScanLocal(input) {
    const source = input || {};
    const hasForm = source.hasForm === true;
    const hasTextarea = source.hasTextarea === true;
    const usableCommentFieldCount = Number(source.usableCommentFieldCount || 0);
    const hasEmbeddedCommentSignal = source.hasEmbeddedCommentSignal === true;
    const embeddedSignalReason = String(source.embeddedSignalReason || '');
    const embeddedSignalSrc = String(source.embeddedSignalSrc || '').toLowerCase();
    if (
      hasForm &&
      !hasTextarea &&
      usableCommentFieldCount <= 0 &&
      hasEmbeddedCommentSignal &&
      embeddedSignalReason === 'comment_iframe' &&
      /(^|\/\/)(www\.)?blogger\.com\/comment\/frame\//.test(embeddedSignalSrc)
    ) {
      return {
        shouldStop: true,
        result: 'manual_required',
        errorMessage: 'embedded Blogger comment iframe requires manual handling'
      };
    }
    if (hasForm && !hasTextarea && usableCommentFieldCount <= 0 && !hasEmbeddedCommentSignal) {
      return {
        shouldStop: true,
        result: 'no_comment_box',
        errorMessage: 'no usable comment input found'
      };
    }
    if (!hasForm && !hasTextarea && usableCommentFieldCount <= 0 && !hasEmbeddedCommentSignal) {
      return {
        shouldStop: true,
        result: 'no_comment_box',
        errorMessage: 'no comment form found'
      };
    }
    return {
      shouldStop: false,
      result: '',
      errorMessage: ''
    };
  }

  function isUsableGeneratedCopy(text) {
    const value = String(text || '').trim();
    if (value.length < 10) return false;
    const lower = value.toLowerCase();
    return !['blocked_keyword', 'undefined', 'null', 'failed to generate', 'unable to parse'].some((marker) => lower.includes(marker));
  }

  function normalizePromotionWebsiteKey(url) {
    const text = String(url || '').trim();
    if (!text) return '__unconfigured__';
    try {
      const parsed = new URL(/^https?:\/\//i.test(text) ? text : `https://${text}`);
      parsed.hash = '';
      return parsed.href.replace(/\/+$/, '').toLowerCase();
    } catch (_) {
      return text.replace(/\/+$/, '').toLowerCase();
    }
  }

  function isSamePromotionWebsite(recordUrl, currentUrl) {
    const currentKey = normalizePromotionWebsiteKey(currentUrl);
    const recordKey = normalizePromotionWebsiteKey(recordUrl);
    return currentKey !== '__unconfigured__' && recordKey === currentKey;
  }

  function isConfirmedBatchSuccessRecord(record, url, promotionWebsiteUrl) {
    if (!record || (record.result !== 'success' && record.result !== 'success_pending_moderation')) return false;
    if (url && record.url !== url) return false;
    if (!isSamePromotionWebsite(record.promotionWebsiteUrl, promotionWebsiteUrl)) return false;
    const currentPromotionKey = normalizePromotionWebsiteKey(promotionWebsiteUrl);
    if (record.copyPromotionWebsiteKey !== currentPromotionKey) return false;
    if (record.confirmedBy !== BATCH_SUCCESS_CONFIRMATION_MARKER) return false;
    if (!isVerifiedBacklinkRecordLocal(record, promotionWebsiteUrl)) return false;
    if (!isUsableGeneratedCopy(record.aiContent)) return false;
    const confirmedAt = Number(record.confirmedAt || record.timestamp || 0);
    if (!confirmedAt) return false;
    return Date.now() - confirmedAt <= BATCH_SUCCESS_DEDUP_WINDOW_MS;
  }

  function isVerifiedBacklinkRecordLocal(record, promotionWebsiteUrl) {
    if (!record || record.linkVerified !== true) return false;
    const matchedHref = String(record.matchedHref || '').trim();
    if (!matchedHref) return false;
    return verifyBacklinkInHtmlLocal(`<a href="${matchedHref.replace(/"/g, '&quot;')}"></a>`, promotionWebsiteUrl).linkVerified;
  }

  function isPrivateModerationPreviewUrlLocal(url) {
    const raw = String(url || '').trim();
    if (!raw) return false;
    try {
      const parsed = new URL(raw, location.origin || 'https://placeholder.invalid/');
      return parsed.searchParams.has('unapproved') && parsed.searchParams.has('moderation-hash');
    } catch (_) {
      return /[?&]unapproved=/.test(raw) && /[?&]moderation-hash=/.test(raw);
    }
  }

  function stripHashFromUrlLocal(url) {
    const raw = String(url || '').trim();
    if (!raw) return '';
    try {
      const parsed = new URL(raw, location.origin || 'https://placeholder.invalid/');
      parsed.hash = '';
      return parsed.href;
    } catch (_) {
      return raw.replace(/#.*$/, '');
    }
  }

  function hasCommentAnchorUrlLocal(url) {
    return /#comment-\d+\b/i.test(String(url || ''));
  }

  function chooseBacklinkVerificationUrlLocal(input) {
    const source = input && typeof input === 'object' ? input : {};
    const originalUrl = String(source.originalUrl || source.verificationUrl || '').trim();
    const currentUrl = String(source.currentUrl || source.pageUrl || '').trim();
    const privateModerationPreview = isPrivateModerationPreviewUrlLocal(currentUrl);
    if (privateModerationPreview) {
      return {
        verificationUrl: stripHashFromUrlLocal(currentUrl) || originalUrl,
        currentUrl,
        privateModerationPreview: true,
        reason: 'private_moderation_preview_page'
      };
    }
    if (currentUrl && hasCommentAnchorUrlLocal(currentUrl) && currentUrl !== originalUrl) {
      return {
        verificationUrl: stripHashFromUrlLocal(currentUrl),
        currentUrl,
        privateModerationPreview: false,
        reason: 'current_comment_anchor_page'
      };
    }
    return {
      verificationUrl: originalUrl || stripHashFromUrlLocal(currentUrl),
      currentUrl,
      privateModerationPreview: false,
      reason: 'original_or_current_url'
    };
  }

  function buildBacklinkVerificationTargetsLocal(input) {
    const source = input && typeof input === 'object' ? input : {};
    const originalUrl = String(source.originalUrl || source.verificationUrl || '').trim();
    const primary = chooseBacklinkVerificationUrlLocal(source);
    const targets = [];
    const seen = new Set();

    function addTarget(target) {
      const verificationUrl = String(target && target.verificationUrl || '').trim();
      if (!verificationUrl || seen.has(verificationUrl)) return;
      seen.add(verificationUrl);
      targets.push(target);
    }

    addTarget(primary);

    if (
      originalUrl &&
      primary.reason === 'current_comment_anchor_page' &&
      primary.verificationUrl !== originalUrl
    ) {
      addTarget({
        verificationUrl: originalUrl,
        currentUrl: primary.currentUrl,
        privateModerationPreview: false,
        reason: 'original_url_fallback'
      });
    }

    return targets;
  }

  async function generatePromotionCopyWithRetry(maxAttempts = 3) {
    let lastError = null;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        console.log('[content] generating AI comment copy, attempt:', attempt);
        const text = await generatePromotionCopyWithQwen();
        if (isUsableGeneratedCopy(text)) {
          lastGeneratedPromotionCopy = String(text).trim();
          lastGeneratedPromotionCopyKey = await getGenerationCacheKey();
          if (maxAttempts <= 1 && _batchCtx) {
            await rememberSuccessfulBatchAiCopy(lastGeneratedPromotionCopy, {
              url: _batchCtx.url,
              urlIndex: _batchCtx.urlIndex
            });
          }
          return lastGeneratedPromotionCopy;
        }
        lastError = new Error('AI generated empty or unusable copy');
      } catch (error) {
        lastError = error;
        console.warn('[content] AI copy generation attempt failed:', attempt, error && error.message ? error.message : error);
      }
      if (attempt < maxAttempts) {
        await new Promise((resolve) => setTimeout(resolve, 1200 * attempt));
      }
    }
    if (maxAttempts <= 1 && _batchCtx) {
      logBatchSubmit('ai.generate_failed_reuse_start', {
        error: lastError && lastError.message ? lastError.message : 'AI copy generation failed'
      });
      const reuseDecision = await getBatchAiCopyAfterGenerationFailure(lastError || new Error('AI copy generation failed'), {
        url: _batchCtx.url,
        urlIndex: _batchCtx.urlIndex
      });
      if (reuseDecision.action === 'reuse') {
        return reuseDecision.reusableCopy.text;
      }
    }
    throw lastError || new Error('AI copy generation failed');
  }

  const API_BASE = (window.AUTO_COMMENT_CONFIG && window.AUTO_COMMENT_CONFIG.API_BASE) || 'http://127.0.0.1:3000/api';
  const QWEN_API_BASE = API_BASE;
  const BATCH_SCRIPT_BUILD_TAG = 'batch-segmented-link-fill-2026-07-14-ai-cancel-01';
  const AUTO_COMMENT_LOG_LEVEL = (window.AUTO_COMMENT_CONFIG && window.AUTO_COMMENT_CONFIG.LOG_LEVEL) || 'essential';
  const AUTO_COMMENT_VERBOSE_LOGS = AUTO_COMMENT_LOG_LEVEL === 'debug';
  if (!AUTO_COMMENT_VERBOSE_LOGS && typeof console !== 'undefined' && !console.__autoCommentReleaseLogFiltered) {
    console.__autoCommentReleaseLogFiltered = true;
    console.log = () => {};
    console.info = () => {};
  }
  console.info('[content][config] API_BASE =', API_BASE);
  const WEBSITE_URL_STORAGE_KEY = 'promotion_website_url';
  const WEBSITE_CONTENT_STORAGE_KEY = 'promotion_website_content';
  const CURRENT_PROMOTION_PROJECT_ID_KEY = 'current_promotion_project_id';
  const USER_NAME_STORAGE_KEY = 'auto_fill_user_name';
  const USER_EMAIL_STORAGE_KEY = 'auto_fill_user_email';
  const USER_PASSWORD_STORAGE_KEY = 'auto_fill_user_password';
  const USER_ID_STORAGE_KEY = 'auto_comment_user_id';
  const DEFAULT_LOCAL_USER_ID = 'local-user';
  const PROMPT_FIELD_VALUES_STORAGE_KEY = 'auto_fill_prompt_field_values';
  const AI_REUSE_STATE_STORAGE_KEY = 'batch_ai_reuse_state_v1';
  let activeAiRequestId = '';
  let currentPromotionProjectCache = {
    project: null,
    projectId: '',
    loadedAt: 0
  };

  // ====== 批量任务设置（从 storage.local 读取）======
  const BATCH_SETTINGS_KEY = 'batch_task_settings';
  const BATCH_URLS_KEY = 'batch_task_urls';
  const BATCH_PENDING_TASK_KEY = 'batch_pending_task';
  const BATCH_RUNTIME_STATE_KEY = 'batch_runtime_state_v1';

  // ====== 积分系统配置 ======
  const POINTS_API_BASE = API_BASE;
  const POINTS_COST_PER_GENERATION = 1;

  // ====== 防重复生成配置 ======
  const DOMAIN_COOLDOWN_MS = 24 * 60 * 60 * 1000;
  const GENERATION_RECORD_KEY = 'qwen_generation_records';
  const SUBMIT_COOLDOWN_MS = 5 * 60 * 1000;
  const SUBMIT_COOLDOWN_KEY = 'qwen_submit_cooldown';
  const BATCH_SUCCESS_DEDUP_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;
  const BATCH_SUCCESS_CONFIRMATION_MARKER = 'submit-confirmed-v3';
  const BATCH_PENDING_TASK_TTL_MS = 10 * 60 * 1000;
  const AI_COPY_REQUEST_TIMEOUT_MS = 180 * 1000;

  function safeLowerStringLocal(value) {
    if (value == null) return '';
    return String(value).toLowerCase();
  }

  function normalizeHostForCompareLocal(value) {
    const raw = String(value || '').trim();
    if (!raw) return '';
    try {
      return new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`).hostname.replace(/^www\./i, '').toLowerCase();
    } catch (_) {
      return raw.replace(/^https?:\/\//i, '').replace(/^www\./i, '').split(/[/?#:]/)[0].toLowerCase();
    }
  }

  function classifyDomainDriftLocal(input) {
    const source = input && typeof input === 'object' ? input : {};
    const originalHost = normalizeHostForCompareLocal(source.originalUrl);
    const currentHost = normalizeHostForCompareLocal(source.currentUrl);
    if (!originalHost || !currentHost || originalHost === currentHost) {
      return { drifted: false, result: '', errorMessage: '', originalHost, currentHost };
    }
    return {
      drifted: true,
      result: 'fail',
      errorMessage: `target page drifted from ${originalHost} to ${currentHost}`,
      originalHost,
      currentHost
    };
  }

  function buildBatchConfirmPayloadLocal(input) {
    const payload = {
      type: 'BATCH_HANDLE_CONFIRM',
      batchId: input.batchId,
      urlIndex: input.urlIndex,
      url: input.url || '',
      aiContent: input.aiContent || '',
      result: input.result || 'fail',
      promotionWebsiteUrl: input.promotionWebsiteUrl || '',
      promotionWebsiteKey: input.promotionWebsiteKey || '',
      copyPromotionWebsiteKey: input.copyPromotionWebsiteKey || '',
      errorMessage: input.errorMessage || null,
      linkVerified: !!input.linkVerified,
      matchedHref: input.matchedHref || '',
      linkVerification: input.linkVerification || null
    };
    if (payload.result === 'success' || payload.result === 'success_pending_moderation') {
      payload.confirmedBy = BATCH_SUCCESS_CONFIRMATION_MARKER;
      payload.confirmedAt = input.confirmedAt || Date.now();
    }
    return payload;
  }

  function buildPreSubmitRecoveryPayloadLocal(input) {
    return buildBatchConfirmPayloadLocal({
      ...input,
      result: 'submitted_unconfirmed',
      errorMessage: input && input.errorMessage
        ? input.errorMessage
        : 'submit started; page changed before confirmation'
    });
  }

  function classifySubmitEvidenceLocal(evidence) {
    const source = evidence || {};
    const explicitError = String(source.explicitError || '').trim();
    if (explicitError) {
      if (/captcha|recaptcha|hcaptcha|turnstile|human verification|security check/i.test(explicitError)) {
        return { result: 'manual_required', reason: explicitError, confidence: 'strong' };
      }
      return { result: 'fail', reason: explicitError, confidence: 'strong' };
    }
    if (source.successMessageFound) {
      return { result: 'success', reason: 'success_message_found', confidence: 'strong' };
    }
    if (source.commentAppeared) {
      return { result: 'success', reason: 'comment_appeared_on_page', confidence: 'strong' };
    }
    const hasSubmitSignal = source.triggerResult && source.triggerResult !== 'timeout' && source.triggerResult !== 'cancelled';
    if (source.textareaCleared && hasSubmitSignal) {
      return { result: 'success', reason: 'textarea_cleared_after_submit', confidence: 'medium' };
    }
    if (source.navigationObserved && hasSubmitSignal) {
      return { result: 'success', reason: 'navigation_without_error', confidence: 'medium' };
    }
    if (hasSubmitSignal) {
      return { result: 'submitted_unconfirmed', reason: 'submit triggered but no acceptance signal', confidence: 'weak' };
    }
    return { result: 'fail', reason: 'submit confirmation timed out', confidence: 'strong' };
  }

  const SUBMIT_ERROR_PATTERN_RULES_LOCAL = [
    { pattern: 'duplicate comment detected', manualRequired: false },
    { pattern: 'you are posting comments too quickly', manualRequired: false },
    { pattern: 'error: please fill the required fields', manualRequired: false },
    { pattern: 'error: please enter a valid email', manualRequired: false },
    { pattern: 'error: please type your comment text', manualRequired: false },
    { pattern: 'you must be logged in to comment', manualRequired: false },
    { pattern: 'comments are closed', manualRequired: false },
    { pattern: 'comment submission failure', manualRequired: false },
    { pattern: 'spam detected', manualRequired: false },
    { pattern: 'captcha verification failed', manualRequired: true },
    { pattern: 'invalid captcha', manualRequired: true },
    { pattern: 'incorrect captcha', manualRequired: true },
    { pattern: 'please complete the captcha', manualRequired: true },
    { pattern: 'recaptcha verification failed', manualRequired: true },
    { pattern: 'hcaptcha verification failed', manualRequired: true },
    { pattern: 'turnstile verification failed', manualRequired: true }
  ];

  function findSubmitErrorEvidenceLocal(input) {
    const source = input && typeof input === 'object' ? input : {};
    const candidateTexts = Array.isArray(source.candidateTexts)
      ? source.candidateTexts.map((text) => String(text || '').trim()).filter(Boolean)
      : [];
    const bodyText = String(source.bodyText || '').trim();
    const allCandidates = [
      ...candidateTexts.map((text, index) => ({ source: 'candidate', index, text })),
      { source: 'body', index: -1, text: bodyText }
    ].filter((item) => item.text);

    for (const item of allCandidates) {
      const lower = item.text.toLowerCase();
      for (const rule of SUBMIT_ERROR_PATTERN_RULES_LOCAL) {
        if (lower.includes(rule.pattern)) {
          return {
            found: true,
            error: `submit failed: ${rule.pattern}`,
            pattern: rule.pattern,
            manualRequired: !!rule.manualRequired,
            source: item.source,
            index: item.index,
            snippet: item.text.replace(/\s+/g, ' ').slice(0, 240),
            candidateCount: candidateTexts.length,
            bodyCaptchaMention: /\bcaptcha\b|recaptcha|hcaptcha|turnstile/i.test(bodyText)
          };
        }
      }
    }

    return {
      found: false,
      error: '',
      pattern: '',
      manualRequired: false,
      source: '',
      index: -1,
      snippet: '',
      candidateCount: candidateTexts.length,
      bodyCaptchaMention: /\bcaptcha\b|recaptcha|hcaptcha|turnstile/i.test(bodyText)
    };
  }

  function classifyRestoredSubmitEvidenceLocal(evidence) {
    const source = evidence || {};
    const explicitError = String(source.explicitError || '').trim();
    if (explicitError) {
      if (/captcha|recaptcha|hcaptcha|turnstile|human verification|security check/i.test(explicitError)) {
        return { result: 'manual_required', reason: explicitError, confidence: 'strong' };
      }
      return { result: 'fail', reason: explicitError, confidence: 'strong' };
    }
    if (source.successMessageFound) {
      return { result: 'success', reason: 'success_message_found_after_restore', confidence: 'strong' };
    }
    if (source.commentAppeared) {
      return { result: 'success', reason: 'comment_appeared_after_restore', confidence: 'strong' };
    }
    return {
      result: 'submitted_unconfirmed',
      reason: 'restored page did not show acceptance signal',
      confidence: 'weak'
    };
  }

  function normalizePromotionTargetLocal(url) {
    const raw = String(url || '').trim();
    if (!raw) return { raw, normalizedUrl: '', hostname: '', pathname: '/', valid: false };
    try {
      const parsed = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
      parsed.hash = '';
      const pathname = (parsed.pathname || '/').replace(/\/+$/, '') || '/';
      return {
        raw,
        normalizedUrl: `${parsed.protocol}//${parsed.hostname.toLowerCase()}${pathname}`,
        hostname: parsed.hostname.toLowerCase(),
        pathname,
        valid: true
      };
    } catch (_) {
      return { raw, normalizedUrl: '', hostname: '', pathname: '/', valid: false };
    }
  }

  function validateCommentReadyForSubmitLocal(input) {
    const source = input && typeof input === 'object' ? input : {};
    const expectedText = String(source.expectedText || '');
    const actualText = String(source.actualText || '');
    const actualHtml = String(source.actualHtml || '');
    const promotion = normalizePromotionTargetLocal(source.promotionUrl || '');
    const expectedLength = expectedText.trim().length;
    const actualLength = actualText.trim().length;
    const minLength = expectedLength > 0 ? Math.max(5, Math.floor(expectedLength * 0.85)) : 5;
    const searchable = `${actualText}\n${actualHtml}`.toLowerCase();
    const promotionHost = promotion.hostname || '';
    const hostFound = !!promotionHost && searchable.includes(promotionHost.toLowerCase());
    const lengthOk = actualLength >= minLength;
    const ok = lengthOk && hostFound;
    let reason = 'ready';
    if (!lengthOk) reason = 'comment_text_too_short';
    else if (!hostFound) reason = 'promotion_host_missing';
    return {
      ok,
      reason,
      expectedLength,
      actualLength,
      minLength,
      promotionHost,
      hostFound,
      lengthOk
    };
  }

  function chooseCommentReadyRecoveryActionLocal(input) {
    const source = input && typeof input === 'object' ? input : {};
    if (source.ready === true) return 'none';
    const attempts = Number(source.attempts);
    if (!Number.isFinite(attempts) || attempts <= 0) return 'segmented_refill';
    if (attempts === 1) return 'direct_set_value';
    return 'fail';
  }

  function extractAnchorHrefsLocal(html) {
    const source = String(html || '');
    const hrefs = [];
    const anchorRe = /<a\b[^>]*\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))[^>]*>/gi;
    let match;
    while ((match = anchorRe.exec(source)) !== null) {
      const href = String(match[1] || match[2] || match[3] || '')
        .replace(/&amp;/gi, '&')
        .replace(/&quot;/gi, '"')
        .replace(/&#39;/gi, "'")
        .trim();
      if (href) hrefs.push(href);
    }
    return hrefs;
  }

  function isExternalHrefCandidateLocal(href) {
    const value = String(href || '').trim();
    return /^[a-z][a-z0-9+.-]*:\/\//i.test(value) || /^\/\//.test(value);
  }

  function verifyBacklinkInHtmlLocal(html, promotionUrl) {
    const promotion = normalizePromotionTargetLocal(promotionUrl);
    const hrefs = extractAnchorHrefsLocal(html);
    if (!promotion.valid) {
      return {
        linkVerified: false,
        matchedHref: '',
        promotionHost: '',
        candidateCount: hrefs.length,
        hostMatchedCount: 0,
        pathMatched: false,
        reason: 'invalid_promotion_url'
      };
    }

    let hostMatchedCount = 0;
    for (const href of hrefs) {
      if (!isExternalHrefCandidateLocal(href)) continue;
      let parsed;
      try {
        const base = /^\/\//.test(String(href || '').trim())
          ? 'https://external-link-base.invalid/'
          : (promotion.normalizedUrl || `https://${promotion.hostname}/`);
        parsed = new URL(href, base);
      } catch (_) {
        continue;
      }
      if (parsed.hostname.toLowerCase() !== promotion.hostname) continue;
      hostMatchedCount++;
      const hrefPath = (parsed.pathname || '/').replace(/\/+$/, '') || '/';
      const needsPath = promotion.pathname && promotion.pathname !== '/';
      const pathMatched = !needsPath || hrefPath === promotion.pathname || hrefPath.startsWith(`${promotion.pathname}/`);
      if (pathMatched) {
        return {
          linkVerified: true,
          matchedHref: href,
          promotionHost: promotion.hostname,
          candidateCount: hrefs.length,
          hostMatchedCount,
          pathMatched: true,
          reason: 'matching_anchor_href_found'
        };
      }
    }

    return {
      linkVerified: false,
      matchedHref: '',
      promotionHost: promotion.hostname,
      candidateCount: hrefs.length,
      hostMatchedCount,
      pathMatched: false,
      reason: hostMatchedCount > 0 ? 'host_matched_path_mismatched' : 'no_matching_anchor_href'
    };
  }

  function detectPromotionSourceHitLocal(html, promotionUrl) {
    const source = String(html || '');
    const promotion = normalizePromotionTargetLocal(promotionUrl);
    const linkVerification = verifyBacklinkInHtmlLocal(source, promotionUrl);
    if (linkVerification.linkVerified) {
      return {
        hit: true,
        reason: 'matching_anchor_href_found',
        matchedHref: linkVerification.matchedHref || '',
        promotionHost: linkVerification.promotionHost || promotion.hostname || '',
        sourceMatched: false
      };
    }
    if (!promotion.valid || !promotion.hostname) {
      return {
        hit: false,
        reason: linkVerification.reason || 'invalid_promotion_url',
        matchedHref: '',
        promotionHost: promotion.hostname || '',
        sourceMatched: false
      };
    }
    const lower = source.toLowerCase();
    const variants = [
      promotion.normalizedUrl,
      promotion.normalizedUrl.replace(/^https?:\/\//i, ''),
      promotion.normalizedUrl.replace(/\/$/, ''),
      promotion.hostname
    ].filter(Boolean).map((item) => String(item).toLowerCase());
    const matchedVariant = variants.find((item) => item && lower.includes(item));
    return {
      hit: !!matchedVariant,
      reason: matchedVariant ? 'promotion_url_found_in_source' : linkVerification.reason || 'no_source_hit',
      matchedHref: linkVerification.matchedHref || '',
      promotionHost: promotion.hostname,
      sourceMatched: !!matchedVariant
    };
  }

  function logBatchSubmit(stage, details = {}) {
    const ctx = _batchCtx || {};
    const entry = {
      stage,
      scriptBuild: BATCH_SCRIPT_BUILD_TAG,
      batchId: details.batchId || ctx.batchId || null,
      urlIndex: details.urlIndex ?? ctx.urlIndex ?? null,
      url: details.url || ctx.url || location.href,
      ...details
    };
    console.log('[AutoComment][batch-submit]', entry);
    sendLocalDebugLog('content', entry);
  }

  function sendLocalDebugLog(source, payload) {
    if (!AUTO_COMMENT_VERBOSE_LOGS) return;
    try {
      const body = JSON.stringify({
        source,
        pageUrl: location.href,
        payload
      });
      fetch(`${API_BASE}/debug-log`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
        keepalive: true
      }).catch(() => {});
    } catch (_) {}
  }

  // 从URL中提取域名（用于冷却判断）
  function extractDomain(url) {
    try {
      const urlObj = new URL(url);
      return urlObj.hostname;
    } catch (e) {
      const match = url.match(/^https?:\/\/([^/]+)/);
      return match ? match[1] : url;
    }
  }

  function getCurrentDomain() {
    return extractDomain(window.location.href);
  }

  // ====== 积分系统函数 ======

  // 从 chrome.storage.sync 读取用户ID（由管理员线下分配）
  function getUserId() {
    return new Promise((resolve) => {
      if (typeof chrome === 'undefined' || !chrome.storage || !chrome.storage.sync) {
        resolve('');
        return;
      }
      chrome.storage.sync.get([USER_ID_STORAGE_KEY], (result) => {
        if (chrome.runtime && chrome.runtime.lastError) {
          console.error('读取用户ID失败：', chrome.runtime.lastError);
          resolve('');
          return;
        }
        const userId = result && typeof result[USER_ID_STORAGE_KEY] === 'string'
          ? result[USER_ID_STORAGE_KEY].trim()
          : DEFAULT_LOCAL_USER_ID;
        resolve(userId || DEFAULT_LOCAL_USER_ID);
      });
    });
  }

  // 查询积分余额
  async function getPointsBalance() {
    const userId = await getUserId();
    if (!userId) {
      return 0;
    }
    try {
      const response = await fetch(`${POINTS_API_BASE}/get-points?userId=${encodeURIComponent(userId)}`);
      const data = await response.json();
      return data.success ? data.points : 0;
    } catch (e) {
      console.error('查询积分失败:', e);
      return 0;
    }
  }

  // 扣减积分
  async function deductPoints(points) {
    const userId = await getUserId();
    if (!userId) {
      return { success: false, error: '用户ID未配置，请在选项页面填写用户ID' };
    }
    try {
      const response = await fetch(`${POINTS_API_BASE}/deduct-points`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, points })
      });
      const data = await response.json();
      return data;
    } catch (e) {
      console.error('扣减积分失败:', e);
      return { success: false, error: e.message };
    }
  }

  // 最近一次 AI 生成的推广文案（用于页面自动填充 & 浮动窗口回显）
  let lastGeneratedPromotionCopy = '';
  let lastGeneratedPromotionCopyKey = '';

  function buildQwenSkillTemplate(promotionWebsiteUrl, promotionWebsiteContent) {
    const targetWebsiteUrl = promotionWebsiteUrl || '未配置网站链接';
    const targetWebsiteContent = promotionWebsiteContent || '未配置网站内容';

    return [
      '你是一个合规的网站营销与评论文案助手，为网站撰写自然、真实的评论文案。',
      '请根据我提供的"当前网站内容"进行分析和创作',
      '',
      '【我的网站信息】',
      `网站链接：${targetWebsiteUrl}`,
      `网站内容：${targetWebsiteContent}`,
      '',
      '',
      '【输出要求】',
      '1. 我需要在当前网站发表评论，评论需要自然关联到上面的"我的网站信息"，并吸引用户访问我的网站。',
      '2. 语气可以专业但要自然、真实。',
      '3. 使用当前网站内容的主要语言作为输出语言，尽量不要使用中文，字数建议控制在 100 词左右。',
      '4. 直接给出推广文案，不要有多余的输出；只输出最终评论内容，不要输出标题、字段名、解释说明或多余格式；',
      '5.【链接格式要求】',
      'You MUST include the promoted website exactly once as an HTML anchor tag, not as a bare URL.',
      'The anchor text MUST be a natural contextual phrase that fits the current page and promoted website.',
      'Do NOT use the URL, domain, "click here", "website", or generic repeated text as anchor text.',
      'Avoid anchor texts already used in this batch if they are provided in the prompt.',
      'If you output any HTML link, the href attribute value MUST contain a real line break immediately before the closing double quote.',
      'Correct example:',
      '<a href="https://example.com/',
      '">点击这里</a>',
      'Wrong examples:',
      '<a href="https://example.com/">点击这里</a>',
      '<a href="https://example.com/\\n">点击这里</a>',
      'The required line break must be an actual newline character in the output, not the two characters \\ and n.'
    ].join('\n');
  }

  async function getQwenSkillTemplate() {
    const [promotionWebsiteUrl, promotionWebsiteContent] = await Promise.all([
      getWebsiteUrl(),
      getWebsiteContent()
    ]);
    return buildQwenSkillTemplate(promotionWebsiteUrl, promotionWebsiteContent);
  }

  function pickLegacyPromptValue(values, keywords) {
    if (!values || typeof values !== 'object') return '';
    const normalizedKeywords = keywords.map((keyword) => String(keyword).toLowerCase());
    const entry = Object.entries(values).find(([key, value]) => {
      if (!value) return false;
      const normalizedKey = String(key || '').toLowerCase();
      return normalizedKeywords.some((keyword) => normalizedKey.includes(keyword));
    });
    return entry ? String(entry[1] || '').trim() : '';
  }

  // 从 chrome.storage.sync 中异步获取推广网站地址
  function getLinkAssistantRuntimeLogic() {
    return window.AutoCommentLinkAssistantRuntimeLogic || null;
  }

  function getBatchPromotionProject() {
    return _batchCtx && _batchCtx.promotionProject ? _batchCtx.promotionProject : null;
  }

  function sendChromeMessage(message) {
    return new Promise((resolve, reject) => {
      if (typeof chrome === 'undefined' || !chrome.runtime || typeof chrome.runtime.sendMessage !== 'function') {
        reject(new Error('chrome_runtime_unavailable'));
        return;
      }
      try {
        chrome.runtime.sendMessage(message, (response) => {
          if (chrome.runtime && chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message || 'chrome_message_failed'));
            return;
          }
          resolve(response);
        });
      } catch (error) {
        reject(error);
      }
    });
  }

  async function linkAssistantApiRequest(path) {
    const bridged = await sendChromeMessage({
      type: 'LINK_ASSISTANT_API_REQUEST',
      apiBase: API_BASE,
      path,
      options: {
        method: 'GET',
        headers: { Accept: 'application/json' }
      }
    });
    if (!bridged || bridged.success === false) {
      throw new Error((bridged && bridged.error) || 'LINK_ASSISTANT_API_REQUEST_FAILED');
    }
    const payload = bridged.json != null ? bridged.json : (bridged.text ? JSON.parse(bridged.text) : {});
    if (!bridged.ok || (payload && payload.success === false)) {
      throw new Error((payload && (payload.message || payload.error)) || `Request failed: ${bridged.status}`);
    }
    return payload;
  }

  async function getCurrentPromotionProjectId() {
    if (typeof chrome === 'undefined' || !chrome.storage || !chrome.storage.local) return '';
    const data = await new Promise((resolve) => {
      chrome.storage.local.get([CURRENT_PROMOTION_PROJECT_ID_KEY], (result) => resolve(result || {}));
    });
    return data[CURRENT_PROMOTION_PROJECT_ID_KEY] ? String(data[CURRENT_PROMOTION_PROJECT_ID_KEY]) : '';
  }

  async function loadCurrentPromotionProject() {
    const batchProject = getBatchPromotionProject();
    if (batchProject && batchProject.targetUrl) return batchProject;

    const currentPromotionProjectId = await getCurrentPromotionProjectId();
    if (!currentPromotionProjectId) return null;
    const now = Date.now();
    if (
      currentPromotionProjectCache.project &&
      currentPromotionProjectCache.projectId === currentPromotionProjectId &&
      now - currentPromotionProjectCache.loadedAt < 15000
    ) {
      return currentPromotionProjectCache.project;
    }

    const logic = getLinkAssistantRuntimeLogic();
    if (!logic || typeof logic.normalizeCurrentProjectResponse !== 'function') return null;
    try {
      const response = await linkAssistantApiRequest('/link-assistant/projects');
      const normalized = logic.normalizeCurrentProjectResponse({ currentPromotionProjectId, response });
      currentPromotionProjectCache = {
        project: normalized.project || null,
        projectId: currentPromotionProjectId,
        loadedAt: now
      };
      if (normalized.project) {
        console.info('[content][link-assistant] current project loaded', {
          projectId: normalized.project.id,
          targetDomain: normalized.project.targetDomain || ''
        });
      }
      return normalized.project || null;
    } catch (error) {
      console.warn('[content][link-assistant] current project load failed:', {
        message: error && error.message ? error.message : String(error)
      });
      return null;
    }
  }

  async function getPromotionCopyInputsFromProject(legacyUrl, legacyContent) {
    const project = await loadCurrentPromotionProject();
    const logic = getLinkAssistantRuntimeLogic();
    if (!project || !logic || typeof logic.selectPromotionCopyInputs !== 'function') {
      return {
        promotionWebsiteUrl: legacyUrl,
        promotionWebsiteContent: legacyContent,
        usedProjectKeywords: []
      };
    }
    return logic.selectPromotionCopyInputs({ project, legacyUrl, legacyContent });
  }

  function getWebsiteUrl() {
    return new Promise((resolve) => {
      if (typeof chrome === 'undefined' || !chrome.storage || !chrome.storage.sync) {
        resolve('');
        return;
      }
      chrome.storage.sync.get([WEBSITE_URL_STORAGE_KEY, PROMPT_FIELD_VALUES_STORAGE_KEY], (result) => {
        if (chrome.runtime && chrome.runtime.lastError) {
          console.error('读取推广网站地址失败：', chrome.runtime.lastError);
          resolve('');
          return;
        }
        const savedUrl = result && typeof result[WEBSITE_URL_STORAGE_KEY] === 'string'
          ? result[WEBSITE_URL_STORAGE_KEY].trim()
          : '';
        const legacyUrl = pickLegacyPromptValue(result && result[PROMPT_FIELD_VALUES_STORAGE_KEY], [
          '网站链接',
          '网址',
          'website link',
          'website url',
          'url'
        ]);
        const fallbackUrl = savedUrl || legacyUrl;
        getPromotionCopyInputsFromProject(fallbackUrl, '').then((inputs) => {
          resolve(inputs.promotionWebsiteUrl || fallbackUrl);
        }).catch(() => resolve(fallbackUrl));
      });
    });
  }

  function getWebsiteContent() {
    return new Promise((resolve) => {
      if (typeof chrome === 'undefined' || !chrome.storage || !chrome.storage.sync) {
        resolve('');
        return;
      }
      chrome.storage.sync.get([WEBSITE_CONTENT_STORAGE_KEY, PROMPT_FIELD_VALUES_STORAGE_KEY], (result) => {
        if (chrome.runtime && chrome.runtime.lastError) {
          console.error('读取推广网站内容失败：', chrome.runtime.lastError);
          resolve('');
          return;
        }
        const savedContent = result && typeof result[WEBSITE_CONTENT_STORAGE_KEY] === 'string'
          ? result[WEBSITE_CONTENT_STORAGE_KEY].trim()
          : '';
        const legacyContent = pickLegacyPromptValue(result && result[PROMPT_FIELD_VALUES_STORAGE_KEY], [
          '网站内容',
          '网站介绍',
          'website content',
          'site content',
          'description'
        ]);
        const fallbackContent = savedContent || legacyContent;
        getWebsiteUrl().then((legacyUrl) => (
          getPromotionCopyInputsFromProject(legacyUrl, fallbackContent)
        )).then((inputs) => {
          resolve(inputs.promotionWebsiteContent || fallbackContent);
        }).catch(() => resolve(fallbackContent));
      });
    });
  }

  // 从 chrome.storage.sync 中异步获取用户的姓名 / 邮箱 / 密码
  function getUserProfile() {
    return new Promise((resolve) => {
      if (typeof chrome === 'undefined' || !chrome.storage || !chrome.storage.sync) {
        resolve({ name: DEFAULT_USERNAME, email: DEFAULT_EMAIL, password: DEFAULT_PASSWORD });
        return;
      }
      chrome.storage.sync.get(
        [USER_NAME_STORAGE_KEY, USER_EMAIL_STORAGE_KEY, USER_PASSWORD_STORAGE_KEY],
        (result) => {
          if (chrome.runtime && chrome.runtime.lastError) {
            console.error('读取用户姓名/邮箱/密码失败：', chrome.runtime.lastError);
            resolve({ name: DEFAULT_USERNAME, email: DEFAULT_EMAIL, password: DEFAULT_PASSWORD });
            return;
          }
          let name = result && typeof result[USER_NAME_STORAGE_KEY] === 'string'
            ? result[USER_NAME_STORAGE_KEY].trim() : '';
          let email = result && typeof result[USER_EMAIL_STORAGE_KEY] === 'string'
            ? result[USER_EMAIL_STORAGE_KEY].trim() : '';
          let password = result && typeof result[USER_PASSWORD_STORAGE_KEY] === 'string'
            ? result[USER_PASSWORD_STORAGE_KEY].trim() : '';

          if (!name) name = DEFAULT_USERNAME;
          if (!email) email = DEFAULT_EMAIL;
          if (!password) password = DEFAULT_PASSWORD;

          loadCurrentPromotionProject().then((project) => {
            resolve({
              name: project && project.commentAuthor ? project.commentAuthor : name,
              email: project && project.contactEmail ? project.contactEmail : email,
              password
            });
          }).catch(() => resolve({ name, email, password }));
        }
      );
    });
  }

  // 从 chrome.storage.local 中获取"是否自动打开浮动窗口"的设置
  // 仅当当前 URL 在批量任务列表中时才返回 true
  function getAutoOpenQwenPanelSetting() {
    return new Promise((resolve) => {
      if (typeof chrome === 'undefined' || !chrome.storage || !chrome.storage.local) {
        resolve(false);
        return;
      }
      // 同时读取设置和 URL 列表
      chrome.storage.local.get([BATCH_SETTINGS_KEY, BATCH_URLS_KEY], (result) => {
        if (chrome.runtime && chrome.runtime.lastError) {
          resolve(false);
          return;
        }
        const settings = result[BATCH_SETTINGS_KEY];
        const urls = result[BATCH_URLS_KEY];
        if (!settings || !urls || !Array.isArray(urls)) {
          resolve(false);
          return;
        }
        // 验证当前 URL 是否在批量任务列表中
        const currentUrl = window.location.href;
        const isInBatch = urls.some(url => currentUrl.startsWith(url) || url.startsWith(currentUrl));
        if (!isInBatch) {
          resolve(false);
          return;
        }
        resolve(Boolean(settings.autoOpenPanel));
      });
    });
  }

  // 从 chrome.storage.local 中获取"是否在页面加载时自动调用 AI 生成"的设置
  // 仅当当前 URL 在批量任务列表中时才返回 true
  function getAutoGenerateQwenOnPageLoadSetting() {
    return new Promise((resolve) => {
      if (typeof chrome === 'undefined' || !chrome.storage || !chrome.storage.local) {
        resolve(false);
        return;
      }
      chrome.storage.local.get([BATCH_SETTINGS_KEY, BATCH_URLS_KEY], (result) => {
        if (chrome.runtime && chrome.runtime.lastError) {
          resolve(false);
          return;
        }
        const settings = result[BATCH_SETTINGS_KEY];
        const urls = result[BATCH_URLS_KEY];
        if (!settings || !urls || !Array.isArray(urls)) {
          resolve(false);
          return;
        }
        const currentUrl = window.location.href;
        const isInBatch = urls.some(url => currentUrl.startsWith(url) || url.startsWith(currentUrl));
        if (!isInBatch) {
          resolve(false);
          return;
        }
        resolve(Boolean(settings.autoGenerate));
      });
    });
  }

  // 从 chrome.storage.local 中获取"是否自动提交评论"的设置
  // 仅当当前 URL 在批量任务列表中时才返回 true
  function getAutoSubmitCommentSetting() {
    return new Promise((resolve) => {
      console.log('[AutoComment] getAutoSubmitCommentSetting 开始检查...');

      if (typeof chrome === 'undefined' || !chrome.storage || !chrome.storage.local) {
        console.log('[AutoComment] chrome 或 chrome.storage.local 未定义，返回 false');
        resolve(false);
        return;
      }

      chrome.storage.local.get([BATCH_SETTINGS_KEY, BATCH_URLS_KEY], (result) => {
        console.log('[AutoComment] storage.local.get 回调，result:', JSON.stringify(result));
        if (chrome.runtime && chrome.runtime.lastError) {
          console.log('[AutoComment] chrome.runtime.lastError 存在，返回 false');
          resolve(false);
          return;
        }
        const settings = result[BATCH_SETTINGS_KEY];
        const urls = result[BATCH_URLS_KEY];
        console.log('[AutoComment] settings:', settings, 'urls:', urls);
        if (!settings || !urls || !Array.isArray(urls)) {
          console.log('[AutoComment] 设置或 URL 列表无效，返回 false');
          resolve(false);
          return;
        }
        // 验证当前 URL 是否在批量任务列表中
        const currentUrl = window.location.href;
        const isInBatch = urls.some(url => currentUrl.startsWith(url) || url.startsWith(currentUrl));
        console.log('[AutoComment] currentUrl:', currentUrl, 'isInBatch:', isInBatch);
        if (!isInBatch) {
          console.log('[AutoComment] 当前 URL 不在批量任务列表中，返回 false');
          resolve(false);
          return;
        }
        const val = Boolean(settings.autoSubmit);
        console.log('[AutoComment] 开关值:', val);
        resolve(val);
      });
    });
  }

  // 检查当前域名是否在冷却时间内
  function isUrlInCooldown() {
    return new Promise((resolve) => {
      const currentDomain = getCurrentDomain();

      if (typeof chrome === 'undefined' || !chrome.storage) {
        resolve(false);
        return;
      }

      let storageArea = null;
      try {
        if (chrome.storage.local && typeof chrome.storage.local.get === 'function') {
          storageArea = chrome.storage.local;
        }
      } catch (_e) {
        resolve(false);
        return;
      }

      if (!storageArea) {
        resolve(false);
        return;
      }

      storageArea.get([GENERATION_RECORD_KEY, SUBMIT_COOLDOWN_KEY], (result) => {
        if (chrome.runtime && chrome.runtime.lastError) {
          resolve(false);
          return;
        }

        const records = result && result[GENERATION_RECORD_KEY];
        const submitCooldown = result && result[SUBMIT_COOLDOWN_KEY];

        if (submitCooldown && submitCooldown.domain === currentDomain) {
          const submitTime = submitCooldown.timestamp || 0;
          const timeSinceSubmit = Date.now() - submitTime;
          if (timeSinceSubmit < SUBMIT_COOLDOWN_MS) {
            resolve(true);
            return;
          }
        }

        if (records && records[currentDomain] && records[currentDomain].timestamp) {
          const lastGenTime = records[currentDomain].timestamp;
          const timeSinceGen = Date.now() - lastGenTime;
          if (timeSinceGen < DOMAIN_COOLDOWN_MS) {
            resolve(true);
            return;
          }
        }

        resolve(false);
      });
    });
  }

  async function getGenerationCacheKey() {
    const promotionWebsiteUrl = await getWebsiteUrl();
    return getCurrentDomain() + '::' + normalizePromotionWebsiteKey(promotionWebsiteUrl);
  }

  async function recordGenerationTime(content) {
    const cacheKey = await getGenerationCacheKey();
    const currentDomain = getCurrentDomain();
    const promotionWebsiteUrl = await getWebsiteUrl();

    return new Promise((resolve) => {
      if (typeof chrome === 'undefined' || !chrome.storage || !chrome.storage.local) {
        resolve();
        return;
      }

      chrome.storage.local.get([GENERATION_RECORD_KEY], (result) => {
        const records = result && result[GENERATION_RECORD_KEY] || {};
        records[cacheKey] = {
          timestamp: Date.now(),
          content: content || '',
          domain: currentDomain,
          promotionWebsiteUrl,
          promotionWebsiteKey: normalizePromotionWebsiteKey(promotionWebsiteUrl)
        };

        const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
        for (const key in records) {
          if (records[key] && records[key].timestamp < sevenDaysAgo) {
            delete records[key];
          }
        }

        chrome.storage.local.set({ [GENERATION_RECORD_KEY]: records }, () => {
          resolve();
        });
      });
    });
  }

  function recordFormSubmit() {
    return new Promise((resolve) => {
      const currentDomain = getCurrentDomain();

      if (typeof chrome === 'undefined' || !chrome.storage || !chrome.storage.local) {
        resolve();
        return;
      }

      chrome.storage.local.set({
        [SUBMIT_COOLDOWN_KEY]: {
          domain: currentDomain,
          timestamp: Date.now()
        }
      }, () => {
        resolve();
      });
    });
  }

  async function getCachedPromotionCopy() {
    const cacheKey = await getGenerationCacheKey();
    return new Promise((resolve) => {
      if (typeof chrome === 'undefined' || !chrome.storage || !chrome.storage.local) {
        resolve('');
        return;
      }

      chrome.storage.local.get([GENERATION_RECORD_KEY], (result) => {
        const records = result && result[GENERATION_RECORD_KEY];
        if (records && records[cacheKey] && records[cacheKey].content) {
          resolve(records[cacheKey].content);
        } else {
          resolve('');
        }
      });
    });
  }

  async function getReusablePromotionCopy() {
    const cached = await getCachedPromotionCopy();
    if (isUsableGeneratedCopy(cached)) return cached;
    const currentKey = await getGenerationCacheKey();
    if (lastGeneratedPromotionCopyKey && lastGeneratedPromotionCopyKey === currentKey && isUsableGeneratedCopy(lastGeneratedPromotionCopy)) {
      return lastGeneratedPromotionCopy;
    }
    return '';
  }

  // 监听表单提交事件
  function setupFormSubmitListener() {
    document.addEventListener('submit', (event) => {
      const form = event.target;
      const isCommentForm = form && (
        safeLowerStringLocal(form.id).includes('comment') ||
        safeLowerStringLocal(form.className).includes('comment') ||
        safeLowerStringLocal(form.method) === 'post'
      );

      if (isCommentForm) {
        setTimeout(() => {
          recordFormSubmit();
        }, 1500);
      }
    }, { capture: true });
  }

  // 在页面打开时自动调用一次 AI 生成
  let autoGeneratedOnce = false;

  // 批处理模式上下文（由 BATCH_HANDLE 消息注入）
  let _batchCtx = null; // { batchId, urlIndex, url }
  let runningBatchTaskKey = null;

  function setBatchContext(batchId, urlIndex, url, context = {}) {
    _batchCtx = {
      batchId,
      urlIndex,
      url,
      promotionProject: context.promotionProject || null,
      promotionProjectId: context.promotionProjectId || null,
      targetUrl: context.targetUrl || '',
      targetDomain: context.targetDomain || '',
      discoveryTargetUrl: context.discoveryTargetUrl || '',
      semrushMeta: context.semrushMeta || null
    };
    activateQwenProgressTabForBatch();
  }

  function getBatchTaskKey(batchId, urlIndex) {
    return `${batchId}:${urlIndex}`;
  }

  function normalizeTaskUrl(value) {
    try {
      const parsed = new URL(value || '', location.href);
      parsed.hash = '';
      return parsed.href.replace(/\/+$/, '');
    } catch (_) {
      return String(value || '').split('#')[0].replace(/\/+$/, '');
    }
  }

  function isSameTaskUrl(expectedUrl, currentUrl) {
    const expected = normalizeTaskUrl(expectedUrl);
    const current = normalizeTaskUrl(currentUrl);
    if (!expected || !current) return false;
    return expected === current || current.startsWith(expected + '?') || expected.startsWith(current + '?');
  }

  async function clearPendingBatchTaskIfMatches(batchId, urlIndex) {
    if (typeof chrome === 'undefined' || !chrome.storage) return;
    await new Promise((resolve) => {
      chrome.storage.local.get([BATCH_PENDING_TASK_KEY], (data) => {
        const pending = data[BATCH_PENDING_TASK_KEY];
        if (pending && pending.batchId === batchId && pending.urlIndex === urlIndex) {
          chrome.storage.local.remove(BATCH_PENDING_TASK_KEY, resolve);
          return;
        }
        resolve();
      });
    });
  }

  async function tryStartPendingBatchTaskFromStorage() {
    if (typeof chrome === 'undefined' || !chrome.storage) return;
    const data = await new Promise((resolve) => chrome.storage.local.get([BATCH_PENDING_TASK_KEY], resolve));
    const pending = data[BATCH_PENDING_TASK_KEY];
    if (!pending || !pending.batchId || pending.urlIndex === undefined || !pending.url) return;

    if (Date.now() - (pending.createdAt || 0) > BATCH_PENDING_TASK_TTL_MS) {
      await clearPendingBatchTaskIfMatches(pending.batchId, pending.urlIndex);
      return;
    }

    if (!isSameTaskUrl(pending.url, location.href)) {
      return;
    }

    const taskKey = getBatchTaskKey(pending.batchId, pending.urlIndex);
    if (runningBatchTaskKey === taskKey) {
      return;
    }

    const submitData = await new Promise((resolve) => chrome.storage.local.get(['batchSubmitCtx'], resolve));
    const submitCtx = submitData.batchSubmitCtx;
    if (submitCtx && submitCtx.batchId === pending.batchId && submitCtx.urlIndex === pending.urlIndex) {
      console.log('[content] pending task has submit context; restore submit confirmation instead of restarting');
      await confirmRestoredBatchSubmit(submitCtx);
      return;
    }

    console.log('[content] starting pending batch task from storage', {
      batchId: pending.batchId,
      urlIndex: pending.urlIndex,
      url: pending.url
    });
    setBatchContext(pending.batchId, pending.urlIndex, pending.url);
    handleBatchTask(pending.batchId, pending.urlIndex, pending.url).catch((err) => {
      console.warn('[content] pending batch task failed:', err);
    });
  }

  async function persistBatchSubmitContext(batchId, urlIndex, url, result, aiContent, errorMessage) {
    if (typeof chrome === 'undefined' || !chrome.storage) return;
    const promotionWebsiteUrl = await getWebsiteUrl();
    await new Promise((resolve) => {
      chrome.storage.local.set({
        batchSubmitCtx: {
          batchId,
          urlIndex,
          url,
          result,
          aiContent: aiContent || null,
          errorMessage: errorMessage || null,
          promotionWebsiteUrl,
          promotionWebsiteKey: normalizePromotionWebsiteKey(promotionWebsiteUrl),
          copyPromotionWebsiteKey: normalizePromotionWebsiteKey(promotionWebsiteUrl),
          confirmedBy: (result === 'success' || result === 'success_pending_moderation') ? BATCH_SUCCESS_CONFIRMATION_MARKER : '',
          confirmedAt: (result === 'success' || result === 'success_pending_moderation') ? Date.now() : null,
          timestamp: Date.now()
        }
      }, resolve);
    });
  }

  async function persistBatchSubmitSuccessEvidence(evidence) {
    try {
      if (typeof chrome === 'undefined' || !chrome.storage || !_batchCtx) return;
      const data = await new Promise((resolve) => chrome.storage.local.get(['batchSubmitCtx'], resolve));
      const ctx = data.batchSubmitCtx;
      if (!ctx || ctx.batchId !== _batchCtx.batchId || Number(ctx.urlIndex) !== Number(_batchCtx.urlIndex)) return;
      await new Promise((resolve) => {
        chrome.storage.local.set({
          batchSubmitCtx: {
            ...ctx,
            successEvidence: {
              classifiedResult: evidence && evidence.result ? evidence.result : '',
              reason: evidence && evidence.reason ? evidence.reason : '',
              confidence: evidence && evidence.confidence ? evidence.confidence : '',
              timestamp: Date.now()
            },
            timestamp: Date.now()
          }
        }, resolve);
      });
    } catch (_) {}
  }

  function clearBatchSubmitContext() {
    if (typeof chrome !== 'undefined' && chrome.storage) {
      chrome.storage.local.remove('batchSubmitCtx', () => {});
    }
  }

  async function confirmRestoredBatchSubmit(ctx) {
    if (!ctx || !ctx.batchId || ctx.urlIndex === undefined) return;
    if (Date.now() - (ctx.timestamp || 0) > 10 * 60 * 1000) {
      clearBatchSubmitContext();
      return;
    }

    console.log('[AutoComment] 恢复提交后上下文，仅补发确认，不重新生成AI:', ctx);
    const promotionUrl = ctx.promotionWebsiteUrl || await getWebsiteUrl();
    const verificationTargets = buildBacklinkVerificationTargetsLocal({
      originalUrl: ctx.url || '',
      currentUrl: location.href
    });
    if (!verificationTargets.length) {
      verificationTargets.push({
        verificationUrl: ctx.url || location.href,
        currentUrl: location.href,
        privateModerationPreview: false,
        reason: 'fallback_context_url'
      });
    }
    let verificationTarget = verificationTargets[0];
    let verificationUrl = verificationTarget.verificationUrl || ctx.url || location.href;
    let linkVerification = null;
    const verificationAttempts = [];
    for (const target of verificationTargets) {
      const targetUrl = target.verificationUrl || ctx.url || location.href;
      const html = await getCurrentPageHtmlForVerification(targetUrl);
      const attemptVerification = verifyBacklinkInHtmlLocal(html, promotionUrl);
      verificationAttempts.push({
        verificationUrl: targetUrl,
        reason: target.reason,
        privateModerationPreview: !!target.privateModerationPreview,
        linkVerified: attemptVerification.linkVerified,
        matchedHref: attemptVerification.matchedHref || '',
        candidateCount: attemptVerification.candidateCount,
        hostMatchedCount: attemptVerification.hostMatchedCount,
        verificationReason: attemptVerification.reason
      });
      verificationTarget = target;
      verificationUrl = targetUrl;
      linkVerification = attemptVerification;
      if (attemptVerification.linkVerified) break;
    }
    if (!linkVerification) {
      linkVerification = verifyBacklinkInHtmlLocal('', promotionUrl);
    }
    const restoredEvidence = {
      explicitError: detectCommentSubmitError(),
      successMessageFound: !!detectSubmitSuccessMessage(),
      commentAppeared: false
    };
    const restoredOutcome = linkVerification.linkVerified
      ? {
          result: verificationTarget.privateModerationPreview ? 'success_pending_moderation' : 'success',
          reason: verificationTarget.privateModerationPreview
            ? 'backlink_anchor_found_in_moderation_preview_after_restore'
            : 'backlink_anchor_found_after_restore',
          confidence: 'strong',
          linkVerification
        }
      : classifyRestoredSubmitEvidenceLocal(restoredEvidence);
    if (!linkVerification.linkVerified && restoredOutcome.result === 'success') {
      restoredOutcome.result = 'submitted_unconfirmed';
      restoredOutcome.reason = 'restored_success_evidence_without_backlink';
      restoredOutcome.confidence = 'medium';
    }
    restoredOutcome.linkVerification = linkVerification;
    const restoredResult = restoredOutcome.result;
    const restoredError = (restoredResult === 'success' || restoredResult === 'success_pending_moderation') ? null : restoredOutcome.reason;

    logBatchSubmit('submit.restore_outcome', {
      batchId: ctx.batchId,
      urlIndex: ctx.urlIndex,
      url: ctx.url || location.href,
      result: restoredResult,
      reason: restoredOutcome.reason,
      confidence: restoredOutcome.confidence,
      explicitError: restoredEvidence.explicitError,
      successMessageFound: restoredEvidence.successMessageFound,
      commentAppeared: restoredEvidence.commentAppeared,
      verificationUrl,
      currentPageUrl: location.href,
      verificationChoiceReason: verificationTarget.reason,
      verificationAttemptCount: verificationAttempts.length,
      verificationAttempts,
      privateModerationPreview: verificationTarget.privateModerationPreview,
      linkVerified: linkVerification.linkVerified,
      matchedHref: linkVerification.matchedHref
    });

    console.log('[AutoComment] restored submit context; reporting observed outcome:', {
      batchId: ctx.batchId,
      urlIndex: ctx.urlIndex,
      result: restoredResult,
      reason: restoredOutcome.reason
    });
    await new Promise((resolve) => {
      const payload = buildBatchConfirmPayloadLocal({
        batchId: ctx.batchId,
        urlIndex: ctx.urlIndex,
        url: ctx.url || '',
        aiContent: ctx.aiContent || '',
        result: restoredResult,
        promotionWebsiteUrl: ctx.promotionWebsiteUrl || '',
        promotionWebsiteKey: ctx.promotionWebsiteKey || '',
        copyPromotionWebsiteKey: ctx.copyPromotionWebsiteKey || '',
        errorMessage: restoredError,
        linkVerified: linkVerification.linkVerified,
        matchedHref: linkVerification.matchedHref,
        linkVerification
      });
      chrome.runtime.sendMessage(payload).then(resolve).catch(resolve);
    });

    clearBatchSubmitContext();
  }

  // 从 storage 恢复提交后上下文（仅补确认，不再恢复成可执行批处理任务）
  async function restoreBatchContext() {
    console.log('[AutoComment] restoreBatchContext 开始');
    if (typeof chrome === 'undefined' || !chrome.storage) return;
    const data = await new Promise((resolve) => chrome.storage.local.get(['batchSubmitCtx', 'batchCtx'], resolve));
    if (data.batchCtx) {
      chrome.storage.local.remove('batchCtx', () => {});
    }
    console.log('[AutoComment] restoreBatchContext batchSubmitCtx:', data.batchSubmitCtx);
    if (data.batchSubmitCtx) {
      await confirmRestoredBatchSubmit(data.batchSubmitCtx);
    }
  }

  // 批处理模式专用：直接上报成功到 background
  async function reportSuccessToBatch(aiContent) {
    if (!_batchCtx) return;
    const { batchId, urlIndex, url } = _batchCtx;
    try {
      await writePendingResult(batchId, urlIndex, url, 'success', aiContent, null);
    } catch (_) {}
    if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage) {
      const promotionWebsiteUrl = await getWebsiteUrl();
      await new Promise((resolve) => {
        chrome.runtime.sendMessage({
          type: 'BATCH_HANDLE_CONFIRM',
          batchId,
          urlIndex,
          url: url || '',
          aiContent,
          result: 'success',
          promotionWebsiteUrl,
          promotionWebsiteKey: normalizePromotionWebsiteKey(promotionWebsiteUrl),
          copyPromotionWebsiteKey: normalizePromotionWebsiteKey(promotionWebsiteUrl),
          confirmedBy: BATCH_SUCCESS_CONFIRMATION_MARKER,
          confirmedAt: Date.now()
        }).then(resolve).catch(resolve);
      });
    }
  }

  /**
   * 批处理模式（刷新后）：填充文案、等待页面自动刷新，刷新即确认成功
   * 与 handleBatchTask 的区别：不重新生成文案，复用 _batchCtx，复用缓存
   */
  async function handleBatchTaskForAutoMode() {
    console.log('[AutoComment] handleBatchTaskForAutoMode 开始');
    if (!_batchCtx) {
      console.log('[AutoComment] handleBatchTaskForAutoMode 跳过：_batchCtx 为空');
      return;
    }
    const { batchId, urlIndex, url } = _batchCtx;
    console.log('[AutoComment] handleBatchTaskForAutoMode _batchCtx:', _batchCtx);

    try {
      // 尝试获取缓存的文案或之前生成的文案
      let promotionText = await getReusablePromotionCopy();
      if (!isUsableGeneratedCopy(promotionText)) {
        promotionText = '';
      }
      console.log('[AutoComment] handleBatchTaskForAutoMode reusableCopy:', !!promotionText, 'lastGeneratedPromotionCopy:', !!lastGeneratedPromotionCopy);

      // 如果没有缓存文案，则触发评论表单流程并生成 AI 文案
      if (!promotionText) {
        console.log('[AutoComment] handleBatchTaskForAutoMode 无缓存文案，触发表单流程并生成文案...');

        // 触发评论表单展开（处理懒加载和需要滚动的情况）
        await triggerCommentFormFlowForBatch(8000);
        // 等待表单加载
        await new Promise(resolve => setTimeout(resolve, 2000));

        // 检查评论表单是否存在
        const form = findCommentForm();
        const ta = findLikelyCommentTextarea({ allowGenericFallback: true });

        if (!form || !ta) {
          console.log('[AutoComment] handleBatchTaskForAutoMode 评论框不存在，结束任务');
          throw new Error('__NO_COMMENT_BOX__');
        }

        const manualCheck = detectManualRequiredChallenge(form);
        if (manualCheck.found) {
          await reportManualRequiredAndClose(batchId, urlIndex, url, null);
          return;
        }

        // 生成 AI 文案
        console.log('[AutoComment] handleBatchTaskForAutoMode 生成AI文案...');
        promotionText = await generatePromotionCopyWithRetry(3);
        if (!promotionText) {
          console.log('[AutoComment] handleBatchTaskForAutoMode blocked generated copy, skip current URL');
          await writePendingResult(batchId, urlIndex, url, 'skipped', null, 'blocked_keyword');
          await reportBatchResult(batchId, urlIndex, 'skipped', null, 'blocked_keyword', url);
          return;
        }
        console.log('[AutoComment] handleBatchTaskForAutoMode AI文案生成成功，长度:', promotionText.length);
      }

      const filled = tryFillCommentTextareaWithPromotion(promotionText);
      console.log('[AutoComment] handleBatchTaskForAutoMode tryFillCommentTextareaWithPromotion 结果:', filled);
      if (!filled) {
        throw new Error('comment textarea fill failed');
      }

      let fillCheck = await ensureAllCommentFormFieldsFilled(promotionText);
      if (!fillCheck.success && (fillCheck.missingFields || []).includes('comment')) {
        const latestTextarea = findLikelyCommentTextarea({ allowGenericFallback: true });
        if (fillSpecificCommentTextarea(latestTextarea, promotionText)) {
          fillCheck = await ensureAllCommentFormFieldsFilled(promotionText);
        }
      }
      if (!fillCheck.success) {
        throw new Error('form fill failed: ' + (fillCheck.missingFields || []).join(', '));
      }

      const promotionWebsiteForSubmit = await getWebsiteUrl();
      assertCommentReadyForSubmit(promotionText, form, ta, promotionWebsiteForSubmit);

      const manualCheckBeforeSubmit = detectManualRequiredChallenge();
      if (manualCheckBeforeSubmit.found) {
        await reportManualRequiredAndClose(batchId, urlIndex, url, promotionText);
        return;
      }

      const beforeSubmitUrl = window.location.href;
      const clickResult = await clickCommentSubmitButton(form);
      await ensureSubmitConfirmed(clickResult);

      await reportSuccessToBatch(promotionText);
    } catch (err) {
      console.error('[AutoComment] handleBatchTaskForAutoMode 异常:', err);
    }
  }

  async function autoGeneratePromotionOnPageLoad() {
    console.log('[AutoComment] autoGeneratePromotionOnPageLoad 调用开始');
    if (autoGeneratedOnce) {
      console.log('[AutoComment] autoGeneratePromotionOnPageLoad 跳过：autoGeneratedOnce=true');
      return;
    }

    console.log('[AutoComment] 页面加载自动生成已关闭；批处理仅由 BATCH_HANDLE 触发，手动生成仅由按钮触发');
  }

  // ====== 滚动触发懒加载评论 ======
  /**
   * 滚动到页面底部触发懒加载评论，然后滚动到评论区域
   */
  async function scrollToTriggerCommentLoading() {
    console.log('[AutoComment] 开始滚动触发懒加载评论...');

    // 先滚动到页面底部触发可能的懒加载
    window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' });
    await new Promise(resolve => setTimeout(resolve, 2000));

    // 再向上滚动到评论区域
    const commentArea = document.querySelector(
      '#comments, .comments, #respond, .respond, .comment-respond, ' +
      '.comments-area, .comment-section, #comments-section'
    );
    if (commentArea) {
      console.log('[AutoComment] 找到评论区域，滚动到该位置');
      commentArea.scrollIntoView({ behavior: 'smooth', block: 'center' });
      await new Promise(resolve => setTimeout(resolve, 1500));
    }

    return !!findLikelyCommentTextarea({ allowGenericFallback: false });
  }

  // ====== 辅助函数 ======
  function isClickable(el) {
    if (!el) return false;
    const style = window.getComputedStyle(el);
    return el.offsetParent !== null &&
           style.visibility !== 'hidden' &&
           style.display !== 'none' &&
           el.disabled !== true;
  }

  // ====== 触发评论表单展开 ======
  /**
   * 查找并点击"回复"链接来展开评论表单（WordPress 等常见用法）
   */
  async function triggerCommentFormExpansion() {
    console.log('[AutoComment] 开始尝试展开评论表单...');

    const replyLinkSelectors = [
      '.comment-reply-link',
      '.reply-link',
      'a[href*="#respond"]',
      'a[href*="#comment"]',
      'a.comment-reply',
      '.respond-link',
      'a[rel="nofollow"][href*="respond"]',
      // 英文关键词
      'a:text("Reply")',
      'a:text("Respond")',
      'a:text("Leave a reply")',
      'a:text("Re")',
      // 泰语相关
      'a:text("ตอบ")',           // ตอบ = 回复
      'a:text("แสดงความคิดเห็น")', // แสดงความคิดเห็น = 发表评论
      'a:text("ความคิดเห็น")',     // ความคิดเห็น = 评论
    ];

    // 遍历所有 a 标签，查找包含回复关键词的链接
    const allLinks = Array.from(document.querySelectorAll('a'));
    const replyLinks = [];
    const replyKeywords = ['reply', 'respond', 'leave a reply', 'leave a comment', 'write a comment', 'add comment', 're', 'ตอบ', 'แสดงความคิดเห็น', 'ความคิดเห็น'];
    
    // 只在评论区域内查找回复链接，避免误点广告
    const commentAreas = [];
    const commentAreaSelectors = [
      '#comments', '.comments', '.comment-section', '#respond', '.respond',
      '.comment-respond', '#comments-section', '.comments-area', '.comment-area',
      '.wpd-thread', '#wpd-thread', '.wpdiscuz',
      // fullcirclecinema.com 等网站使用的主评论容器
      '.post-comments', '.entry-comments', '.post-comment',
      '#post-comments', '#entry-comments',
      '.comment-wrapper', '.commentlist', '#commentlist',
      '.comments-area', '.comment_content', '.comment-body'
    ];
    for (const sel of commentAreaSelectors) {
      try {
        const areas = document.querySelectorAll(sel);
        areas.forEach(area => commentAreas.push(area));
      } catch (_) {}
    }
    
    // 收集评论区域内的所有链接
    const linksInCommentArea = new Set();
    for (const area of commentAreas) {
      const links = area.querySelectorAll('a');
      links.forEach(link => linksInCommentArea.add(link));
    }
    
    for (const link of allLinks) {
      // 如果链接不在评论区域内，跳过（避免误点广告）
      if (!linksInCommentArea.has(link)) continue;
      
      const text = (link.textContent || '').toLowerCase().trim();
      const href = (link.getAttribute('href') || '').toLowerCase();
      
      // 只匹配明确的回复链接，避免误点
      const isReplyLink = 
        replyKeywords.some(kw => text.includes(kw)) ||
        (href.includes('#respond') && !href.startsWith('http'));
      
      if (isReplyLink) {
        replyLinks.push(link);
      }
    }
    
    console.log('[AutoComment] 找到回复链接数量:', replyLinks.length);
    
    // 依次尝试点击回复链接
    for (const link of replyLinks) {
      if (!isClickable(link)) continue;
      
      console.log('[AutoComment] 点击回复链接:', link.textContent.trim());
      try {
        link.click();
        
        // 等待评论表单展开
        for (let wait = 0; wait < 3000; wait += 300) {
          await new Promise(resolve => setTimeout(resolve, 300));
          const form = findCommentForm();
          if (form) {
            console.log('[AutoComment] 评论表单已展开');
            return true;
          }
          const ta = findLikelyCommentTextarea({ allowGenericFallback: false });
          if (ta) {
            console.log('[AutoComment] 找到评论 textarea');
            return true;
          }
        }
      } catch (e) {
        console.log('[AutoComment] 点击回复链接失败:', e.message);
      }
    }

    // 尝试直接定位 #respond 并点击其中的链接
    const respondArea = document.querySelector('#respond, .respond, .comment-respond, #comment-respond, .wpdiscuz');
    if (respondArea) {
      console.log('[AutoComment] 找到评论区域');
      const innerLinks = respondArea.querySelectorAll('a');
      for (const link of innerLinks) {
        if (isClickable(link)) {
          const text = (link.textContent || '').toLowerCase();
          // 跳过社交分享链接，避免误点广告
          const skipKeywords = ['share', 'facebook', 'twitter', 'email', 'print', 'pinterest', 'linkedin', 'copy link'];
          if (skipKeywords.some(kw => text.includes(kw))) continue;
          
          try {
            console.log('[AutoComment] 点击评论区域内的链接:', link.textContent.trim());
            link.click();
            await new Promise(resolve => setTimeout(resolve, 1500));
            
            const form = findCommentForm();
            if (form) {
              console.log('[AutoComment] 评论表单已展开');
              return true;
            }
          } catch (e) {}
        }
      }
    }

    console.log('[AutoComment] 未能展开评论表单');
    return false;
  }

  // ====== 完整触发评论流程 ======
  /**
   * 组合滚动 + 点击回复链接 + 等待表单加载
   */
  async function triggerCommentFormFlow() {
    // 步骤1: 先尝试直接找评论表单
    let form = findCommentForm();
    let ta = findLikelyCommentTextarea({ allowGenericFallback: false });

    if (form && ta) {
      console.log('[AutoComment] 直接找到评论表单，无需触发');
      return true;
    }

    // 步骤2: 滚动触发懒加载
    const scrolled = await scrollToTriggerCommentLoading();
    if (scrolled) {
      console.log('[AutoComment] 滚动后找到评论表单');
      return true;
    }

    // 步骤3: 点击回复链接展开表单
    const expanded = await triggerCommentFormExpansion();
    if (expanded) {
      console.log('[AutoComment] 点击回复链接后展开表单');
      return true;
    }

    // 步骤4: 再滚动一次并等待
    await scrollToTriggerCommentLoading();

    return !!findLikelyCommentTextarea({ allowGenericFallback: false });
  }

  async function triggerCommentFormFlowForBatch(timeoutMs = 8000) {
    let timer = null;
    try {
      return await Promise.race([
        triggerCommentFormFlow(),
        new Promise((resolve) => {
          timer = setTimeout(() => resolve(false), Math.max(1000, Number(timeoutMs) || 8000));
        })
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  async function initOnPageReady() {
    console.log('[AutoComment] initOnPageReady 开始');
    // 只恢复提交后的补确认上下文；正式批处理执行只由 BATCH_HANDLE 触发。
    await restoreBatchContext();

    fillInputs();
    setupFormSubmitListener();
    ensureOutlinkFloatingButton();
    tryStartPendingBatchTaskFromStorage();

    getAutoOpenQwenPanelSetting().then((shouldOpen) => {
      if (shouldOpen) {
        createOrToggleQwenPanel();
      }
    });

    getAutoGenerateQwenOnPageLoadSetting().then((shouldAutoGenerate) => {
      if (shouldAutoGenerate) {
        triggerCommentFormFlow().then(() => {
          autoGeneratePromotionOnPageLoad();
        });
      }
    });

    observeDynamicElements();
  }

  let hasNotifiedCommentBox = false;
  let hasCheckedInitialCommentBox = false;
  let hasTriggeredCommentFlow = false;

  function observeDynamicElements() {
    setTimeout(() => {
      if (!hasCheckedInitialCommentBox) {
        hasCheckedInitialCommentBox = true;
        const hasCommentBox = !!findLikelyCommentTextarea({ allowGenericFallback: false });
        console.log('[AutoComment] 初始检查 hasCommentBox:', hasCommentBox, 'hasNotifiedCommentBox:', hasNotifiedCommentBox);
        if (hasCommentBox && !hasNotifiedCommentBox) {
          hasNotifiedCommentBox = true;
          getAutoGenerateQwenOnPageLoadSetting().then((shouldAutoGenerate) => {
            console.log('[AutoComment] 初始检查 shouldAutoGenerate:', shouldAutoGenerate, 'autoGeneratedOnce:', autoGeneratedOnce);
            if (shouldAutoGenerate && !autoGeneratedOnce) {
              autoGeneratePromotionOnPageLoad();
            }
          });
        }
      }
    }, 1000);

    const observer = new MutationObserver((mutations) => {
      let shouldTriggerFlow = false;

      // 检查是否有新的 textarea 或评论区域出现
      const newTextareas = document.querySelectorAll('textarea');
      if (newTextareas.length > 0 && !hasNotifiedCommentBox) {
        const hasCommentBox = !!findLikelyCommentTextarea({ allowGenericFallback: false });
        if (hasCommentBox) {
          shouldTriggerFlow = true;
          hasNotifiedCommentBox = true;
          console.log('[AutoComment] MutationObserver 检测到评论 textarea 出现');
          getAutoGenerateQwenOnPageLoadSetting().then((shouldAutoGenerate) => {
            console.log('[AutoComment] shouldAutoGenerate:', shouldAutoGenerate, 'autoGeneratedOnce:', autoGeneratedOnce);
            if (shouldAutoGenerate && !autoGeneratedOnce) {
              // 直接调用，不等待 triggerCommentFormFlow，因为 textarea 已存在
              autoGeneratePromotionOnPageLoad();
            } else {
              console.log('[AutoComment] 自动生成条件不满足，跳过');
            }
          });
        }
      }

      // 检查是否有新的回复链接被添加（增强）
      const newReplyLinks = document.querySelectorAll(
        '.comment-reply-link:not([data-auto-comment-clicked]), ' +
        '.reply-link:not([data-auto-comment-clicked]), ' +
        'a[href*="#respond"]:not([data-auto-comment-clicked])'
      );

      if (newReplyLinks.length > 0 && !hasTriggeredCommentFlow) {
        getAutoGenerateQwenOnPageLoadSetting().then((shouldAutoGenerate) => {
          if (shouldAutoGenerate && !autoGeneratedOnce && !hasTriggeredCommentFlow) {
            hasTriggeredCommentFlow = true;
            console.log('[AutoComment] MutationObserver 检测到回复链接，自动触发评论流程');

            // 标记已点击的链接，避免重复
            newReplyLinks.forEach(link => {
              link.setAttribute('data-auto-comment-clicked', 'true');
            });

            // 自动点击回复链接来展开表单
            triggerCommentFormFlow().then(() => {
              setTimeout(() => {
                autoGeneratePromotionOnPageLoad();
              }, 500);
            });
          }
        });
      }

      // 检查是否有新的评论区域出现（增强）
      const newCommentAreas = document.querySelectorAll(
        '#respond:not([data-auto-comment-checked]), ' +
        '.respond:not([data-auto-comment-checked]), ' +
        '.comment-respond:not([data-auto-comment-checked])'
      );

      newCommentAreas.forEach(area => {
        area.setAttribute('data-auto-comment-checked', 'true');
        // 检查这个区域内是否有表单或 textarea
        const hasForm = area.querySelector('form');
        const hasTextarea = area.querySelector('textarea');
        if ((hasForm || hasTextarea) && !hasNotifiedCommentBox) {
          shouldTriggerFlow = true;
        }
      });
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      initOnPageReady();
    });
  } else {
    initOnPageReady();
  }

  function findNativeWordPressCommentForm() {
    const selectors = [
      'form#commentform',
      'form.comment-form',
      'form[name="commentform"]',
      'form[action*="wp-comments-post.php"]'
    ];

    for (const selector of selectors) {
      const form = document.querySelector(selector);
      if (form && getCommentTextareaFromForm(form)) {
        return form;
      }
    }

    return null;
  }

  function getCommentTextareaFromForm(form) {
    if (!form) return null;
    return (
      form.querySelector('textarea#comment') ||
      form.querySelector('textarea[name="comment"]') ||
      form.querySelector('textarea[id*="comment" i]') ||
      form.querySelector('textarea[name*="comment" i]') ||
      null
    );
  }

  function findLikelyCommentTextarea(options) {
    const allowGenericFallback = options && options.allowGenericFallback;
    const allTextareas = Array.from(document.querySelectorAll('textarea'));
    if (allTextareas.length === 0) return null;

    const commentTextareas = [];
    const commentForms = new Set();

    const wpNativeForm = findNativeWordPressCommentForm();
    const wpNativeTextarea = getCommentTextareaFromForm(wpNativeForm);
    if (wpNativeTextarea) {
      console.log('[AutoComment] 优先命中 WordPress 原生评论框:', {
        formId: wpNativeForm.id,
        formClass: wpNativeForm.className,
        textareaId: wpNativeTextarea.id,
        textareaName: wpNativeTextarea.name
      });
      return wpNativeTextarea;
    }

    // 方法0: 检测 wpDiscuz 可编辑 div（ contenteditable 评论框）
    const wpDiscuzEditor = findWpDiscuzEditor();
    if (wpDiscuzEditor) {
      console.log('[AutoComment] 找到 wpDiscuz 编辑器:', wpDiscuzEditor.className);
      const form = wpDiscuzEditor.closest('form');
      if (form) {
        commentForms.add(form);
      }
      // 返回一个兼容对象，模拟 textarea
      return {
        _isWpDiscuz: true,
        _realElement: wpDiscuzEditor,
        get value() { return this._realElement.textContent || ''; },
        set value(v) { this._realElement.textContent = v; },
        form: form,
        closest: wpDiscuzEditor.closest.bind(wpDiscuzEditor),
        querySelector: wpDiscuzEditor.querySelector.bind(wpDiscuzEditor),
        querySelectorAll: wpDiscuzEditor.querySelectorAll.bind(wpDiscuzEditor)
      };
    }

    // 方法1: 通过标准的 WordPress/comment 选择器直接查找
    const standardSelectors = [
      '#comment',
      'textarea[name="comment"]',
      'textarea#comment',
      'textarea[id="comment"]',
      'textarea[name="comment_content"]',
      'textarea[id="comment_content"]',
      'textarea[name="comments"]',
      'textarea#comments',
      'textarea.wpcf7-textarea'
    ];

    for (const selector of standardSelectors) {
      try {
        const ta = document.querySelector(selector);
        if (ta && !commentTextareas.includes(ta)) {
          commentTextareas.push(ta);
          const form = ta.form || (ta.closest && ta.closest('form'));
          if (form) {
            commentForms.add(form);
          }
        }
      } catch (e) {
        // 忽略无效选择器
      }
    }

    // 方法2: 通过关键词匹配
    allTextareas.forEach((ta) => {
      if (commentTextareas.includes(ta)) return; // 避免重复

      const name = (ta.name || '').toLowerCase();
      const id = (ta.id || '').toLowerCase();
      const placeholder = (ta.placeholder || '').toLowerCase();
      const ariaLabel = (ta.getAttribute('aria-label') || '').toLowerCase();
      const text = `${name} ${id} ${placeholder} ${ariaLabel}`;

      const keywords = [
        'comment',
        'comentario',
        'reply',
        'respuesta',
        'message',
        'mensaje',
        'review',
        'reseña',
        'feedback',
        'opinion',
        'opinión',
        'commenttext',
        '留言',
        '评论',
        '回复',
        '响应',
        // 泰语相关
        'ความคิดเห็น',     // ความคิดเห็น = 评论
        'แสดง',           // แสดง = 显示/发表
        'ข้อความ',        // ข้อความ = 消息/文本
        'ตอบ',            // ตอบ = 回复
        // 英语通用评论关键词
        'leave a comment',
        'write a comment',
        'post a comment',
        'cancel reply',
        'subscribe',
        // 增强：fullcirclecinema 等博客/新闻站点
        'what do you think',
        'share your thoughts',
        'type here',
        'enter your comment',
      ];
      if (keywords.some((k) => text.includes(k))) {
        commentTextareas.push(ta);
        const form = ta.form || (ta.closest && ta.closest('form'));
        if (form) {
          commentForms.add(form);
        }
      }
    });

    // 方法3: 通过表单的 class/id/keyword 检测 WordPress 和其他常见表单
    if (commentForms.size === 0) {
      const forms = Array.from(document.querySelectorAll('form'));
      forms.forEach((form) => {
        const text = safeLowerStringLocal(form.textContent || '');
        const className = safeLowerStringLocal(form.className || '');
        const id = safeLowerStringLocal(form.id || '');
        const action = safeLowerStringLocal(form.action || '');

        // WordPress 和其他评论表单关键词（增强：添加泰语/葡萄牙语/西班牙语关键词）
        const keywords = [
          'deja una respuesta',
          'deja un comentario',
          'tu dirección de correo electrónico no será publicada',
          'comentario *',
          'leave a reply',
          'leave a comment',
          'post comment',
          'submit comment',
          'your name',
          'your email',
          'your comment',
          '姓名',
          '邮箱',
          '评论',
          '留言',
          '回复',
          'be first to comment',
          'cancel reply',
          'logged in as',
          // 泰语评论相关
          'ความคิดเห็น',         // ความคิดเห็น = 评论
          'แสดงความคิดเห็น',    // แสดงความคิดเห็น = 发表意见
          'ตอบกลับ',            // ตอบกลับ = 回复
          // 葡萄牙语评论相关
          'deixe um comentário',
          'deixe um comentario',
          'deixe um comentário',
          'comentário',
          'comentario',
          'seu nome',
          'seu email',
          'seu comentário',
          'seu comentario',
          'enviar comentário',
          'enviar comentario',
          'required fields',
          'campos obrigatórios',
          'campos obligatorios',
          'endereço de email',
          'endereço não será publicado',
          // 西班牙语评论相关
          'dejar un comentario',
          'tu nombre',
          'tu correo',
          'tu comentario',
          'enviar comentario',
          'campos requeridos',
          // Contact Form 7 通用关键词
          'your name',
          'your e-mail',
          'your email',
          'your message',
          'your subject',
          'subject:',
          'e-mail address',
          'email address',
          'phone',
          'tel:',
          'send',
          'submit',
          'send message',
          'send inquiry',
          'book',
          'order',
          'inquiry',
          'contact form',
          'Save my name',
          'will not be published',
          'required fields',
          'fields are marked',
          // SyncedReview 等站点的评论按钮文本
          'post comment',
          'leave a reply',
          'add comment',
          'follow-up comments',
          'new posts by email',
          'new comments',
          // fullcirclecinema 等电影/博客站点关键词
          'cancel reply',
          'you must be logged in',
          'logged in as',
          'notify me of',
          'want to join the discussion',
          'join the discussion',
          'subscribe to our'
        ];

        // WordPress 和其他表单选择器
        const formSelectors = [
          '#commentform',
          '.comment-form',
          '.commentform',
          '#respond',
          '.respond',
          '.comment-respond',
          '.wpcf7-form',
          '[class*="comment-form"]',
          '[id*="comment-form"]',
          '[class*="respond"]',
          '[id*="respond"]',
          'form[action*="comment"]',
          'form[id*="comment"]',
          'form[class*="comment"]',
          // SyncedReview 等站点
          'form[action=""]',
          'form[action="/wp-comments-post.php"]'
        ];

        const isWordPressForm = formSelectors.some(sel => {
          try {
            return document.querySelector(sel) === form;
          } catch (e) {
            return className.includes(sel.replace('#', '').replace('.', ''));
          }
        });

        const hasKeyword = keywords.some((k) => text.includes(k));
        const hasWPForm = isWordPressForm || action.includes('wp-comments-post') || action.includes('comment');

        if (hasKeyword || hasWPForm) {
          commentForms.add(form);
        }
      });
    }

    // 方法4: 在评论区域附近查找 textarea
    if (commentForms.size === 0) {
      const commentAreaSelectors = [
        '#comments',
        '.comments',
        '.comment-section',
        '#respond',
        '.respond',
        '.reply',
        '#comments-section',
        '.comments-area',
        '.comment-list',
        '.commentarea',
        '[class*="comment-area"]',
        '[id*="comment-area"]',
        // 增强：更多 WordPress 主题常见类名
        '.comment-respond',
        '#comment-respond',
        '.wp-comments-area',
        '.comments-area',
        '.comment-wrapper',
        '.entry-comments',
        '.post-comments',
        '.comment-body-wrapper',
        '#comments-area',
        // 增强：嵌套回复容器
        '.comment-inner',
        '.comment-content',
        '.comment_container',
        '#comment_container',
        '[id*="div-comment"]',
        '[class*="depth"]',
        // 葡萄牙语/西班牙语评论区域
        '.comentarios',
        '#comentarios',
        '.comentario',
        '#comentario',
        '[class*="comentario"]',
        '.deixe-comentario',
        '.deixe-um-comentario',
        '.dejar-comentario',
        '.dejar-un-comentario',
        '.comentarios-section',
        '.post-comments-area',
        // 增强：fullcirclecinema 等电影/博客站点的评论容器
        '.post-comments',
        '#post-comments',
        '.entry-comments',
        '#entry-comments',
        '.commentlist',
        '#commentlist',
        '.comment-body',
        '.commentlist-content',
        // 增强：更多评论区域变体
        '.post-comment',
        '#post-comment',
        '.article-comments',
        '.story-comments'
      ];

      for (const selector of commentAreaSelectors) {
        try {
          const areas = document.querySelectorAll(selector);
          areas.forEach(area => {
            // 在评论区域内查找所有 textarea
            const areaTextareas = area.querySelectorAll('textarea');
            areaTextareas.forEach(ta => {
              if (!commentTextareas.includes(ta)) {
                commentTextareas.push(ta);
              }
            });

            // 如果区域在表单内，获取表单
            const form = area.closest ? area.closest('form') : null;
            if (form) {
              commentForms.add(form);
            }
          });
        } catch (e) {
          // 忽略无效选择器
        }
      }
    }

    // 方法5: 检测 Disqus 评论系统
    if (commentForms.size === 0 && commentTextareas.length === 0) {
      const disqusIndicator = document.querySelector(
        '#disqus_thread, ' +
        '[id*="disqus"], ' +
        'iframe[src*="disqus"], ' +
        '.dsq-brlink, ' +
        '#disqus_thread_injection'
      );
      if (disqusIndicator) {
        console.log('[AutoComment] 检测到 Disqus 评论系统:', disqusIndicator.id || disqusIndicator.className);
        // Disqus 需要用户点击 "Join the discussion" 或类似按钮来展开评论框
        // 尝试点击展开 Disqus 评论框
        const disqusOpenBtn = document.querySelector(
          '#disqus_thread a, ' +
          '[id*="disqus"] a, ' +
          '.dsq-brlink a, ' +
          'a[href*="disqus"], ' +
          // Disqus 通用展开按钮
          '#disqus_thread button, ' +
          '.disqus-comment-count, ' +
          '[data-disqus-identifier]'
        );
        if (disqusOpenBtn && !disqusOpenBtn.hasAttribute('data-auto-comment-clicked')) {
          console.log('[AutoComment] 点击 Disqus 展开按钮');
          disqusOpenBtn.setAttribute('data-auto-comment-clicked', 'true');
          disqusOpenBtn.click();
          // 返回一个占位对象，稍后会再次检测
          return {
            _isDisqusPlaceholder: true,
            _disqusIndicator: disqusIndicator,
            value: '',
            get value() { return ''; },
            set value(v) { /* ignore */ },
            form: null,
            closest: disqusIndicator.closest.bind(disqusIndicator),
            querySelector: disqusIndicator.querySelector.bind(disqusIndicator),
            querySelectorAll: disqusIndicator.querySelectorAll.bind(disqusIndicator)
          };
        }
      }
    }

    let targetTextarea = null;

    if (commentTextareas.length > 0) {
      targetTextarea = commentTextareas[0];
    } else if (commentForms.size > 0) {
      for (const form of commentForms) {
        const formTextareas = Array.from(form.querySelectorAll('textarea'));
        if (formTextareas.length > 0) {
          targetTextarea = formTextareas[0];
          break;
        }
      }
    }

    if (!targetTextarea && allowGenericFallback) {
      targetTextarea = allTextareas[0];
    }

    return targetTextarea || null;
  }

  // ====== 通用评论提交按钮检测函数 ======
  /**
   * 输入: 无（依赖 DOM）
   * 输出: { form, button } 与当前评论框同一表单的提交控件，避免与页面上其它表单的 submit 混淆
   */
  function resolveCommentFormAndSubmitButton() {
    const ta = findLikelyCommentTextarea({ allowGenericFallback: true });
    if (ta) {
      const form = ta.form || (ta.closest && ta.closest('form'));
      if (form) {
        const btn = findSubmitButtonInForm(form);
        if (btn) return { form, button: btn };
      }
    }
    const commentForm = findCommentForm();
    if (commentForm) {
      const btn = findSubmitButtonInForm(commentForm);
      if (btn) return { form: commentForm, button: btn };
    }
    const standalone = findStandaloneSubmitButton();
    if (standalone) {
      const form =
        standalone.form ||
        (standalone.closest && standalone.closest('form')) ||
        null;
      return { form, button: standalone };
    }
    return { form: null, button: null };
  }

  function findCommentSubmitButton() {
    return resolveCommentFormAndSubmitButton().button;
  }

  /**
   * 查找 wpDiscuz 可编辑 div 评论框
   */
  function findWpDiscuzEditor() {
    // wpDiscuz 常用选择器
    const selectors = [
      '.wpdiscuz-comment-text-wrap',
      '.wpd-form-input',
      '.wpd-form-field',
      'div[id*="wpdiscuz"]',
      'div[class*="wpdiscuz"]',
      '[contenteditable="true"]'
    ];
    
    for (const sel of selectors) {
      try {
        const editors = document.querySelectorAll(sel);
        for (const editor of editors) {
          // 检查是否是可编辑的评论框
          const isEditable = editor.getAttribute('contenteditable') === 'true' || 
                           editor.className.includes('wpdiscuz') ||
                           editor.id.includes('wpdiscuz');
          if (isEditable && isLikelyWpDiscuzEditorCandidateLocal(editor)) {
            // 进一步验证：在评论区域附近
            const commentWrap = editor.closest('#comments, .comments, .comment-section, .wpd-thread');
            if (commentWrap || editor.closest('.wpdiscuz, [id*="wpdiscuz"], [class*="wpdiscuz"]')) {
              return editor;
            }
          }
        }
      } catch (e) {}
    }
    
    // 备用：查找所有 contenteditable 元素并筛选
    const allEditable = document.querySelectorAll('[contenteditable="true"]');
    for (const el of allEditable) {
      const className = safeLowerStringLocal(el.className || '');
      const id = safeLowerStringLocal(el.id || '');
      const parent = el.closest('#comments, .comments, .comment-section');
      
      if (isLikelyWpDiscuzEditorCandidateLocal(el) &&
          (className.includes('wpdiscuz') || id.includes('wpdiscuz') || parent)) {
        return el;
      }
    }
    
    return null;
  }

  // 查找评论表单
  function findCommentForm() {
    // ── 方案A：直接用 WordPress 标准 form 选择器 ─────────────
    const formSelectors = [
      '#commentform',
      '.comment-form',
      '.commentform',
      'form[name="commentform"]',
      'form[id="commentform"]',
      'form[class*="comment-form"]',
      'form[id*="comment-form"]'
    ];
    for (const sel of formSelectors) {
      try {
        const el = document.querySelector(sel);
        if (el && el.tagName === 'FORM') {
          console.log('[AutoComment] 方案A找到表单:', sel);
          return el;
        }
      } catch (_) {}
    }

    // ── 方案B：先找 textarea，再用 ta.form / closest('form') ──
    const textarea = findLikelyCommentTextarea({ allowGenericFallback: true });
    if (textarea) {
      if (textarea.form) {
        console.log('[AutoComment] 方案B通过 textarea.form 找到表单');
        return textarea.form;
      }
      if (textarea.closest) {
        const parentForm = textarea.closest('form');
        if (parentForm) {
          console.log('[AutoComment] 方案B通过 textarea.closest("form") 找到表单');
          return parentForm;
        }
      }
    }

    // ── 方案C：在评论区域附近找 form ─────────────────────────
    const areaSelectors = [
      '#comments', '#respond', '.comment-respond',
      '#comments-section', '.comments-area', '.comment-section'
    ];
    for (const sel of areaSelectors) {
      const area = document.querySelector(sel);
      if (area) {
        const f = area.querySelector('form') || (area.closest ? area.closest('form') : null);
        if (f) {
          console.log('[AutoComment] 方案C通过评论区域找到表单:', sel);
          return f;
        }
      }
    }

    // ── 方案D：直接找页面所有表单中含 comment/respond 关键词的 ─
    const allForms = Array.from(document.querySelectorAll('form'));
    for (const f of allForms) {
      const text = safeLowerStringLocal(f.textContent || '');
      const cls = safeLowerStringLocal(f.className || '');
      const fid = safeLowerStringLocal(f.id || '');
      if (text.includes('comment') || text.includes('respond') ||
          cls.includes('comment') || fid.includes('comment') ||
          cls.includes('respond') || fid.includes('respond')) {
        console.log('[AutoComment] 方案D通过关键词找到表单:', f.id, f.className);
        return f;
      }
    }

    // ── 以下为原逻辑（备选方案）──────────────────────────────
    // 方法0: 检测 wpDiscuz
    const wpDiscuzEditor = findWpDiscuzEditor();
    if (wpDiscuzEditor) {
      const form = wpDiscuzEditor.closest('form');
      if (form) return form;
    }

    // 方法1: 通过 textarea 关联的表单
    const commentTextarea = findLikelyCommentTextarea({ allowGenericFallback: true });
    if (commentTextarea) {
      const form = commentTextarea.form || (commentTextarea.closest && commentTextarea.closest('form'));
      if (form) return form;
    }

    // 方法2: 通过表单 class/id 查找
    const legacySelectors = [
      '#commentform',
      '.comment-form',
      '.commentform',
      '#respond',
      '.respond',
      '.comment-respond',
      'form[name="commentform"]',
      'form[id*="comment"]',
      'form[class*="comment"]',
      'form[action*="comment"]'
    ];

    for (const selector of legacySelectors) {
      const form = document.querySelector(selector);
      if (form) return form;
    }

    // 方法3: 通过关键词文本查找
    const forms = Array.from(document.querySelectorAll('form'));
    for (const form of forms) {
      const text = safeLowerStringLocal(form.textContent || '');
      const className = safeLowerStringLocal(form.className || '');
      const id = safeLowerStringLocal(form.id || '');

      const keywords = [
        'comment', 'reply', 'respond', '留言', '评论', '回复',
        'post a comment', 'post comment', 'submit comment', 'leave a reply'
      ];

      if (keywords.some(k => text.includes(k) || className.includes(k) || id.includes(k))) {
        return form;
      }
    }

    // 方法4: 通过评论区域查找
    const commentAreaSelectors = [
      '#comments', '.comments', '.comment-section', '#respond',
      '.respond', '.reply', '#comments-section', '.comments-area'
    ];

    for (const selector of commentAreaSelectors) {
      const area = document.querySelector(selector);
      if (area) {
        const form = area.querySelector('form') || area.closest('form');
        if (form) return form;
      }
    }

    return null;
  }

  // 在指定表单中查找提交按钮
  function findSubmitButtonInForm(form) {
    if (!form) return null;

    // 方法1: 通过标准 WordPress 选择器直接查找
    const wpSelectors = [
      '#submit',
      '#submit-btn',
      '#publish',
      'input#submit',
      'input[type="submit"]#submit',
      '.submit',
      'input.submit',
      'button.submit',
      '[name="submit"]',
      'input[name="submit"]',
      'button[name="submit"]',
      'input[type="submit"][name="submit"]',
      'input[name="publish"]',
      'button[name="publish"]',
      '.publish',
      '#wp-submit',
      // wpDiscuz 特定选择器
      '.wpd-submit-btn',
      '.wpdiscuz-submit-btn',
      '.wpd-button',
      'button[id*="wpdiscuz"]',
      'button[class*="wpdiscuz"]',
      '#wpdtdfьи_submit',
      '.wc_comment_submit'
    ];

    for (const selector of wpSelectors) {
      try {
        const btn = form.querySelector(selector);
        if (btn) {
          console.log('[AutoComment] 通过 WordPress 选择器找到提交按钮:', selector);
          return btn;
        }
      } catch (e) {
        // 忽略无效选择器
      }
    }

    // 方法2: 查找所有可能的提交元素（表单内无 type 的 button 默认为 submit）
    const candidates = form.querySelectorAll(
      'button[type="submit"], button:not([type]), input[type="submit"], input[type="image"], [role="submit"]'
    );

    if (candidates.length > 0) {
      // 优先返回有明确提交相关的按钮
      for (const btn of candidates) {
        const value = (btn.value || '').toLowerCase();
        const className = (btn.className || '').toLowerCase();
        const id = (btn.id || '').toLowerCase();
        const text = (btn.textContent || '').toLowerCase();

        // 检查是否包含提交相关关键词（包含西班牙语和 publish）
        const submitKeywords = [
          'submit', 'post', 'comment', 'publish', 'publicar',
          'responder', 'enviar', 'reply', 'send', 'comentar',
          'replicar', 'dejar', 'commentaire', 'comentar',
          'anzeigen', 'absenden', '回答', '返信',
          'post a comment'
        ];

        if (submitKeywords.some(k => value.includes(k) || className.includes(k) || id.includes(k) || text.includes(k))) {
          console.log('[AutoComment] 通过关键词找到提交按钮:', { value, className, id, text });
          return btn;
        }
      }

      // 如果没有找到关键词匹配，返回第一个
      console.log('[AutoComment] 找到提交按钮（第一个）:', candidates[0].tagName);
      return candidates[0];
    }

    // 方法3: 通过文本内容查找（包括 input value）
    const allButtons = form.querySelectorAll('button, input[type="button"]');
    for (const btn of allButtons) {
      const text = (btn.textContent || btn.value || '').toLowerCase().trim();
      const className = (btn.className || '').toLowerCase();
      const id = (btn.id || '').toLowerCase();

      const submitKeywords = [
        'submit', 'post', 'comment', 'reply', 'respond', 'publish',
        '提交', '评论', '发送', 'publicar', 'responder', 'enviar',
        'post comment', 'submit comment', 'post a comment'
      ];

      if (submitKeywords.some(k => text.includes(k) || className.includes(k) || id.includes(k))) {
        console.log('[AutoComment] 通过文本找到提交按钮:', { text, className, id });
        return btn;
      }
    }

    // 如果表单只有一个按钮，返回它
    if (allButtons.length === 1) {
      console.log('[AutoComment] 表单只有一个按钮，返回它');
      return allButtons[0];
    }

    // 方法4: 返回表单内的第一个提交类型输入
    const submitInputs = form.querySelectorAll('input');
    for (const input of submitInputs) {
      const type = (input.type || '').toLowerCase();
      if (type === 'submit' || type === 'image') {
        console.log('[AutoComment] 返回第一个 submit input');
        return input;
      }
    }

    return null;
  }

  // 查找独立的提交按钮（不在表单内但在评论区域附近）
  function findStandaloneSubmitButton() {
    const submitKeywords = [
      'submit', 'post', 'comment', 'publish', 'respond', 'reply',
      '提交', '评论', '发送', 'publicar', 'responder', 'enviar',
      'comentar', 'dejar', 'anzeigen', 'absenden', '回答', '返信'
    ];

    // 方法1: 通过 class/id 查找常见提交按钮选择器
    const commonSelectors = [
      '#submit',
      '#submit-btn',
      '#submit-button',
      '#publish',
      '#wp-submit',
      'input#submit',
      'input[type="submit"]#submit',
      '.submit',
      '.submit-btn',
      '.submit-button',
      '.publish',
      'input.submit',
      'button.submit',
      '.comment-submit',
      '.post-comment',
      '#post-comment',
      '.btn-submit',
      '.submit-comment',
      '.wpcf7-submit',
      '#wpcf7-submit',
      '.form-submit',
      '#form-submit'
    ];

    for (const selector of commonSelectors) {
      try {
        const btn = document.querySelector(selector);
        if (btn) {
          console.log('[AutoComment] 通过选择器找到独立提交按钮:', selector);
          return btn;
        }
      } catch (e) {
        // 忽略无效选择器
      }
    }

    // 方法2: 直接查找所有提交按钮
    const submitButtons = document.querySelectorAll(
      'button[type="submit"], input[type="submit"], input[type="image"]'
    );

    for (const btn of submitButtons) {
      const text = (btn.textContent || btn.value || '').toLowerCase();
      const className = (btn.className || '').toLowerCase();
      const id = (btn.id || '').toLowerCase();
      const name = (btn.name || '').toLowerCase();

      // 检查是否包含提交相关关键词
      if (submitKeywords.some(k =>
        text.includes(k) ||
        className.includes(k) ||
        id.includes(k) ||
        name.includes(k)
      )) {
        console.log('[AutoComment] 通过关键词找到独立提交按钮:', { text, className, id });
        return btn;
      }
    }

    // 方法3: 返回页面中的第一个提交按钮（在评论区域附近）
    const commentAreas = document.querySelectorAll(
      '#comments, .comments, .comment-section, #respond, .respond, .reply, .comment-respond, ' +
      '.comments-area, .commentlist, .comment-area, #comments-section, .comments-section'
    );

    for (const area of commentAreas) {
      // 在评论区域查找提交按钮
      const areaButtons = area.querySelectorAll(
        'button[type="submit"], input[type="submit"], input[type="image"]'
      );
      for (const btn of areaButtons) {
        console.log('[AutoComment] 在评论区域找到提交按钮');
        return btn;
      }

      // 在评论区域查找带有提交关键词的按钮
      const allButtons = area.querySelectorAll('button, input[type="button"]');
      for (const btn of allButtons) {
        const text = (btn.textContent || btn.value || '').toLowerCase();
        if (submitKeywords.some(k => text.includes(k))) {
          console.log('[AutoComment] 在评论区域通过关键词找到按钮');
          return btn;
        }
      }
    }

    // 方法4: 如果只有一个提交按钮，直接返回
    if (submitButtons.length === 1) {
      console.log('[AutoComment] 页面只有一个提交按钮，返回它');
      return submitButtons[0];
    }

    return null;
  }

  // 检查按钮是否可见且可点击
  function isTrustedSubmitButtonForHiddenTab(button) {
    if (!button) return false;
    const id = String(button.id || '').toLowerCase();
    const className = String(button.className || '').toLowerCase();
    const name = String(button.name || '').toLowerCase();
    const type = String(button.type || '').toLowerCase();
    return (
      type === 'submit' ||
      name === 'submit' ||
      id.includes('submit') ||
      className.includes('submit') ||
      id.includes('wpd') ||
      className.includes('wpd') ||
      id.includes('wpdiscuz') ||
      className.includes('wpdiscuz')
    );
  }

  function classifySubmitButtonClickabilityLocal(input) {
    const source = input || {};
    if (source.disabled === true) return { clickable: false, reason: 'disabled' };
    if (source.ariaDisabled === true || source.ariaDisabled === 'true') return { clickable: false, reason: 'aria_disabled' };
    if (source.display === 'none') return { clickable: false, reason: 'display_none' };
    if (source.visibility === 'hidden') return { clickable: false, reason: 'visibility_hidden' };
    if (String(source.opacity) === '0') return { clickable: false, reason: 'opacity_zero' };
    const rectWidth = Number(source.rectWidth || 0);
    const rectHeight = Number(source.rectHeight || 0);
    if ((rectWidth === 0 || rectHeight === 0) && source.isTrustedSubmitButton === true && source.documentHasFocus === false) {
      return { clickable: true, reason: 'trusted_submit_button_in_unfocused_tab' };
    }
    if (rectWidth === 0 || rectHeight === 0) return { clickable: false, reason: 'zero_rect' };
    return { clickable: true, reason: 'visible' };
  }

  function chooseInitialStopReportModeLocal(input) {
    const source = input && typeof input === 'object' ? input : {};
    return source.result ? 'confirm_and_close' : 'report_only';
  }

  function isButtonClickable(button) {
    if (!button) return false;

    // 检查 disabled 状态
    if (button.disabled) {
      console.log('[AutoComment] 按钮被禁用');
      return false;
    }

    if (button.getAttribute('aria-disabled') === 'true') {
      console.log('[AutoComment] 按钮 aria-disabled 为 true');
      return false;
    }

    const style = window.getComputedStyle(button);
    const rect = button.getBoundingClientRect();
    const clickability = classifySubmitButtonClickabilityLocal({
      disabled: !!button.disabled,
      ariaDisabled: button.getAttribute('aria-disabled') === 'true',
      display: style.display,
      visibility: style.visibility,
      opacity: style.opacity,
      rectWidth: rect.width,
      rectHeight: rect.height,
      documentHasFocus: typeof document.hasFocus === 'function' ? document.hasFocus() : true,
      isTrustedSubmitButton: isTrustedSubmitButtonForHiddenTab(button)
    });
    logBatchSubmit('submit.button_clickability', {
      clickable: clickability.clickable,
      reason: clickability.reason,
      buttonId: button.id || '',
      buttonName: button.name || '',
      buttonType: button.type || '',
      buttonClass: button.className ? String(button.className).slice(0, 120) : '',
      display: style.display,
      visibility: style.visibility,
      opacity: style.opacity,
      rectWidth: rect.width,
      rectHeight: rect.height,
      documentHasFocus: typeof document.hasFocus === 'function' ? document.hasFocus() : true
    });
    if (clickability.clickable) {
      return true;
    }
    if (clickability.reason === 'disabled' || clickability.reason === 'aria_disabled') {
      console.log('[AutoComment] submit button is disabled:', clickability.reason);
      return false;
    }

    // 检查是否可见
    if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') {
      console.log('[AutoComment] 按钮不可见:', { display: style.display, visibility: style.visibility, opacity: style.opacity });
      return false;
    }

    // 检查尺寸
    if (rect.width === 0 || rect.height === 0) {
      console.log('[AutoComment] 按钮尺寸为0:', { width: rect.width, height: rect.height });
      return false;
    }

    // 检查是否在视口内（允许部分可见）
    const viewportHeight = window.innerHeight || document.documentElement.clientHeight;
    const viewportWidth = window.innerWidth || document.documentElement.clientWidth;

    // 至少部分可见即可
    const isPartiallyVisible = !(rect.bottom < 0 || rect.top > viewportHeight || rect.right < 0 || rect.left > viewportWidth);

    if (!isPartiallyVisible) {
      console.log('[AutoComment] 按钮不在视口内，尝试立即滚动（避免 smooth 未完成导致坐标错误）');
      try {
        button.scrollIntoView({ behavior: 'auto', block: 'center', inline: 'nearest' });
        return true;
      } catch (e) {
        console.log('[AutoComment] 滚动失败:', e.message);
        return false;
      }
    }

    return true;
  }

  // 点击提交按钮并处理结果
  function chooseSubmitLookupStrategyLocal(input) {
    return input && input.hasPreferredForm ? 'preferred-form' : 'document-scan';
  }

  async function clickCommentSubmitButton(preferredForm = null) {
    logBatchSubmit('submit.lookup_start', {
      hasPreferredForm: !!preferredForm,
      preferredFormId: preferredForm && preferredForm.id ? preferredForm.id : '',
      preferredFormClass: preferredForm && preferredForm.className ? String(preferredForm.className).slice(0, 120) : ''
    });
    logBatchSubmit('submit.lookup_strategy', {
      strategy: chooseSubmitLookupStrategyLocal({ hasPreferredForm: !!preferredForm })
    });

    if (preferredForm) {
      const preferredButton = findSubmitButtonInForm(preferredForm);
      logBatchSubmit('submit.lookup_preferred_form_done', {
        foundButton: !!preferredButton,
        formId: preferredForm && preferredForm.id ? preferredForm.id : '',
        buttonTag: preferredButton ? preferredButton.tagName : '',
        buttonId: preferredButton && preferredButton.id ? preferredButton.id : '',
        buttonName: preferredButton && preferredButton.name ? preferredButton.name : '',
        buttonType: preferredButton && preferredButton.type ? preferredButton.type : ''
      });
      if (preferredButton) {
        logBatchSubmit('submit.lookup_done', {
          foundForm: true,
          foundButton: true,
          formId: preferredForm && preferredForm.id ? preferredForm.id : '',
          formClass: preferredForm && preferredForm.className ? String(preferredForm.className).slice(0, 120) : '',
          buttonTag: preferredButton.tagName || '',
          buttonId: preferredButton.id || '',
          buttonName: preferredButton.name || '',
          buttonType: preferredButton.type || '',
          buttonText: preferredButton.textContent ? preferredButton.textContent.trim().slice(0, 80) : ''
        });
        return await performClick(preferredButton);
      }
    }
    console.log('[AutoComment] ===== 开始自动提交评论 =====');
    console.log('[AutoComment] 当前URL:', window.location.href);

    // 列出页面上所有按钮供调试
    const allButtons = document.querySelectorAll('button, input[type="submit"], input[type="button"], a[class*="submit"], input[type="image"]');
    console.log('[AutoComment] 页面中所有按钮/链接:', Array.from(allButtons).map(b => ({
      tagName: b.tagName,
      type: b.type,
      id: b.id,
      className: b.className,
      name: b.name,
      value: b.value,
      text: b.textContent ? b.textContent.trim().substring(0, 50) : ''
    })));

    const resolved = resolveCommentFormAndSubmitButton();
    const form = resolved.form;
    const button = resolved.button;
    console.log('[AutoComment] resolveCommentFormAndSubmitButton:', {
      formId: form ? form.id : null,
      formClass: form ? form.className : null,
      buttonTag: button ? button.tagName : null,
      buttonId: button ? button.id : null
    });

    if (!button) {
      console.log('[AutoComment] 未找到任何提交按钮');
      return { success: false, error: '未找到评论提交按钮' };
    }

    return await performClick(button);
  }

  async function ensureSubmitConfirmed(clickResult) {
    if (!clickResult || !clickResult.success) {
      throw new Error((clickResult && clickResult.error) || 'submit button click failed');
    }

    const submitResult = clickResult.submitResult || 'timeout';
    if (submitResult === 'timeout') {
      throw new Error('submit confirmation timed out');
    }

    await new Promise(resolve => setTimeout(resolve, 1500));
    const submitError = detectCommentSubmitError();
    if (submitError) {
      throw new Error(submitError);
    }

    return submitResult;
  }

  function detectCommentSubmitError() {
    return getSubmitErrorEvidence().error;
  }

  function getSubmitErrorEvidence() {
    const candidateTexts = collectSubmitErrorCandidateTexts();
    const bodyText = document.body && document.body.innerText ? document.body.innerText : '';
    return findSubmitErrorEvidenceLocal({ bodyText, candidateTexts });
  }

  function collectSubmitErrorCandidateTexts() {
    const selectors = [
      '[role="alert"]',
      '[aria-live]',
      '.error',
      '.notice-error',
      '.comment-error',
      '.comment-form-error',
      '.wp-error',
      '.wpdiscuz-error',
      '.wpcf7-not-valid-tip',
      '.akismet-error',
      '#comment-error',
      '#comments .error',
      '#respond .error',
      '#commentform .error'
    ];
    const seen = new Set();
    const texts = [];
    for (const selector of selectors) {
      let nodes = [];
      try {
        nodes = Array.from(document.querySelectorAll(selector));
      } catch (_) {
        nodes = [];
      }
      for (const node of nodes) {
        if (!node || seen.has(node)) continue;
        seen.add(node);
        if (!isVisibleNode(node)) continue;
        const text = (node.innerText || node.textContent || '').replace(/\s+/g, ' ').trim();
        if (text) texts.push(text);
      }
    }
    return texts.slice(0, 20);
  }

  function isVisibleNode(node) {
    if (!node || !node.ownerDocument || !node.ownerDocument.documentElement.contains(node)) return false;
    const style = window.getComputedStyle(node);
    if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) return false;
    const rect = node.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  const SUBMIT_SUCCESS_PATTERNS = [
    'comment awaiting moderation',
    'awaiting moderation',
    'comment has been posted',
    'comment posted',
    'thank you for your comment',
    'your comment is awaiting moderation',
    'your comment is pending moderation'
  ];

  function getGeneratedCommentPrefix(text) {
    return String(text || '').replace(/\s+/g, ' ').trim().slice(0, 60).toLowerCase();
  }

  function detectSubmitSuccessMessage() {
    const text = (document.body && document.body.innerText ? document.body.innerText : '').toLowerCase();
    return SUBMIT_SUCCESS_PATTERNS.find((pattern) => text.includes(pattern)) || '';
  }

  async function getCurrentPageHtmlForVerification(verificationUrl = location.href) {
    await new Promise((resolve) => setTimeout(resolve, 1200));
    const domHtml = document.documentElement ? document.documentElement.outerHTML : '';
    const targetUrl = String(verificationUrl || location.href);
    const isPrivatePreview = isPrivateModerationPreviewUrlLocal(location.href);
    const isVerifyingCurrentPage = targetUrl === location.href;
    try {
      const response = await fetch(targetUrl, {
        method: 'GET',
        credentials: 'omit',
        cache: 'no-store'
      });
      const contentType = response.headers.get('content-type') || '';
      if (response.ok && /text\/html|application\/xhtml\+xml/i.test(contentType)) {
        const fetchedHtml = await response.text();
        if (fetchedHtml && fetchedHtml.length >= domHtml.length * 0.5) {
          return fetchedHtml;
        }
      }
    } catch (error) {
      console.log('[AutoComment][verify-link] fetch latest html failed; using DOM html', {
        verificationUrl: targetUrl,
        isPrivatePreview,
        error: error && error.message ? error.message : String(error)
      });
    }
    if (!isVerifyingCurrentPage) {
      return '';
    }
    return domHtml;
  }

  async function observeSubmitOutcome(clickResult, expectedText, textarea, beforeUrl) {
    const waitUntil = Date.now() + 8000;
    let lastEvidence = null;

    while (Date.now() < waitUntil) {
      const errorEvidence = getSubmitErrorEvidence();
      const explicitError = errorEvidence.error;
      const successMessage = detectSubmitSuccessMessage();
      const bodyText = (document.body && document.body.innerText ? document.body.innerText : '').replace(/\s+/g, ' ').toLowerCase();
      const prefix = getGeneratedCommentPrefix(expectedText);
      const commentAppeared = !!prefix && bodyText.includes(prefix);
      const textareaValue = textarea ? getCommentFieldText(textarea) : '';
      const textareaCleared = !!textarea && textareaValue.trim().length === 0;
      const triggerResult = clickResult && clickResult.submitResult ? clickResult.submitResult : 'timeout';
      const navigationObserved = location.href !== beforeUrl || triggerResult === 'navigating' || triggerResult === 'pagehide';

      lastEvidence = {
        triggerResult,
        explicitError,
        successMessageFound: !!successMessage,
        commentAppeared,
        textareaCleared,
        navigationObserved
      };

      const classified = classifySubmitEvidenceLocal(lastEvidence);
      logBatchSubmit('submit.error_scan', {
        found: !!errorEvidence.found,
        explicitError,
        pattern: errorEvidence.pattern,
        manualRequired: !!errorEvidence.manualRequired,
        source: errorEvidence.source,
        candidateCount: errorEvidence.candidateCount,
        bodyCaptchaMention: !!errorEvidence.bodyCaptchaMention,
        snippet: errorEvidence.snippet
      });
      logBatchSubmit('submit.observe.tick', {
        triggerResult,
        explicitError,
        successMessageFound: lastEvidence.successMessageFound,
        commentAppeared,
        textareaCleared,
        navigationObserved,
        classifiedResult: classified.result,
        reason: classified.reason,
        confidence: classified.confidence
      });

      if (classified.result === 'success' && classified.confidence === 'strong') {
        await persistBatchSubmitSuccessEvidence(classified);
      }

      if (classified.result === 'fail' || classified.result === 'manual_required') {
        return classified;
      }

      await new Promise((resolve) => setTimeout(resolve, 500));
    }

    const promotionWebsiteUrl = await getWebsiteUrl();
    const verificationTarget = chooseBacklinkVerificationUrlLocal({
      originalUrl: beforeUrl || (_batchCtx && _batchCtx.url) || '',
      currentUrl: location.href
    });
    const verificationUrl = verificationTarget.verificationUrl || beforeUrl || (_batchCtx && _batchCtx.url) || location.href;
    logBatchSubmit('verify.link_start', {
      promotionHost: normalizePromotionTargetLocal(promotionWebsiteUrl).hostname,
      verificationUrl,
      verificationChoiceReason: verificationTarget.reason,
      currentPageUrl: location.href,
      privateModerationPreview: verificationTarget.privateModerationPreview
    });
    const latestHtml = await getCurrentPageHtmlForVerification(verificationUrl);
    const linkVerification = verifyBacklinkInHtmlLocal(latestHtml, promotionWebsiteUrl);
    logBatchSubmit('verify.link_done', {
      verificationUrl,
      verificationChoiceReason: verificationTarget.reason,
      currentPageUrl: location.href,
      privateModerationPreview: verificationTarget.privateModerationPreview,
      linkVerified: linkVerification.linkVerified,
      promotionHost: linkVerification.promotionHost,
      candidateCount: linkVerification.candidateCount,
      hostMatchedCount: linkVerification.hostMatchedCount,
      pathMatched: linkVerification.pathMatched,
      matchedHref: linkVerification.matchedHref,
      reason: linkVerification.reason
    });

    if (linkVerification.linkVerified) {
      return {
        result: verificationTarget.privateModerationPreview ? 'success_pending_moderation' : 'success',
        reason: verificationTarget.privateModerationPreview
          ? 'backlink_anchor_found_in_moderation_preview'
          : 'backlink_anchor_found',
        confidence: 'strong',
        linkVerification
      };
    }

    const finalEvidence = lastEvidence || {
      triggerResult: clickResult && clickResult.submitResult ? clickResult.submitResult : 'timeout'
    };
    const hadSubmitEvidence = !!(
      (finalEvidence.triggerResult && finalEvidence.triggerResult !== 'timeout' && finalEvidence.triggerResult !== 'cancelled') ||
      finalEvidence.successMessageFound ||
      finalEvidence.textareaCleared ||
      finalEvidence.navigationObserved
    );

    if (hadSubmitEvidence) {
      return {
        result: 'submitted_unconfirmed',
        reason: 'submit_evidence_without_backlink',
        confidence: finalEvidence.successMessageFound ? 'medium' : 'weak',
        linkVerification
      };
    }

    return {
      result: 'fail',
      reason: 'submit_not_triggered',
      confidence: 'strong',
      linkVerification
    };
  }

  /**
   * 等待页面导航发生（页面刷新/跳转/隐藏时立即 resolve；超时则 resolve）
   * 用于：点击提交按钮后等待页面响应，以确认是否成功触发表单提交
   */
  async function waitForNavigate(timeoutMs = 8000) {
    return new Promise((resolve) => {
      let resolved = false;
      function finish(result) {
        if (resolved) return;
        resolved = true;
        cleanup();
        resolve(result);
      }
      function cleanup() {
        clearTimeout(timer);
        window.removeEventListener('beforeunload', onBeforeUnload);
        window.removeEventListener('pagehide', onPageHide);
      }
      function onBeforeUnload() { finish('navigating'); }
      function onPageHide(e) { finish(e.persisted ? 'pagehide-persisted' : 'pagehide'); }
      const timer = setTimeout(() => finish('timeout'), timeoutMs);
      window.addEventListener('beforeunload', onBeforeUnload);
      window.addEventListener('pagehide', onPageHide);
    });
  }

  /**
   * 同时检测 AJAX 提交请求和页面导航，任一发生即 resolve
   * 用于：点击提交按钮后，等待表单提交（不管页面是否跳转）
   * @param {number} timeoutMs - 超时毫秒数
   * @returns {Promise<string>} 'ajax' | 'navigating' | 'pagehide' | 'timeout'
   */
  function createSubmitOrNavigateWatcher(timeoutMs = 10000) {
    return new Promise((resolve) => {
      let resolved = false;
      let submitSignalSeen = false;
      let submitSignalSource = '';
      function finish(result) {
        if (resolved) return;
        resolved = true;
        cleanup();
        resolve(result);
      }
      function cleanup() {
        clearTimeout(timer);
        document.removeEventListener('submit', onSubmit, true);
        if (window.XMLHttpRequest) {
          window.XMLHttpRequest.prototype.open = originalXHROpen;
        }
        if (window.fetch) {
          window.fetch = originalFetch;
        }
        window.removeEventListener('beforeunload', onBeforeUnload);
        window.removeEventListener('pagehide', onPageHide);
      }
      function onSubmit(e) { finish('ajax'); }
      function onBeforeUnload() { finish('navigating'); }
      function onPageHide(e) { finish(e.persisted ? 'pagehide' : 'pagehide'); }

      // 拦截 fetch
      const originalFetch = window.fetch;
      window.fetch = function(input, init) {
        if (!resolved && isFormSubmitUrl(input)) finish('ajax');
        return originalFetch.apply(this, arguments);
      };

      // 拦截 XHR
      const originalXHROpen = window.XMLHttpRequest.prototype.open;
      window.XMLHttpRequest.prototype.open = function(method, url, ...rest) {
        if (!resolved && isFormSubmitUrl(url)) finish('ajax');
        return originalXHROpen.call(this, method, url, ...rest);
      };

      document.addEventListener('submit', onSubmit, true);
      window.addEventListener('beforeunload', onBeforeUnload);
      window.addEventListener('pagehide', onPageHide);

      const timer = setTimeout(() => {
        if (submitSignalSeen) {
          logBatchSubmit('submit.watcher_submit_signal_only', {
            submitSignalSource,
            timeoutMs,
            currentUrl: location.href
          });
          finish('ajax');
          return;
        }
        finish('timeout');
      }, timeoutMs);
    }).then((result) => result);
  }

  function startSubmitOrNavigateWatcher(timeoutMs = 10000) {
    let cancelWatcher = null;
    const promise = new Promise((resolve) => {
      let resolved = false;
      function finish(result) {
        if (resolved) return;
        resolved = true;
        cleanup();
        resolve(result);
      }
      function cleanup() {
        clearTimeout(timer);
        document.removeEventListener('submit', onSubmit, true);
        if (window.XMLHttpRequest) {
          window.XMLHttpRequest.prototype.open = originalXHROpen;
        }
        if (window.fetch) {
          window.fetch = originalFetch;
        }
        window.removeEventListener('beforeunload', onBeforeUnload);
        window.removeEventListener('pagehide', onPageHide);
      }
      function recordSubmitSignal(source) {
        submitSignalSeen = true;
        submitSignalSource = submitSignalSource || source;
      }
      function onSubmit(e) {
        recordSubmitSignal(e && e.defaultPrevented ? 'submit-prevented' : 'submit');
      }
      function onBeforeUnload() { finish('navigating'); }
      function onPageHide(e) { finish(e.persisted ? 'pagehide' : 'pagehide'); }

      const originalFetch = window.fetch;
      window.fetch = function(input, init) {
        if (!resolved && isFormSubmitUrl(input)) recordSubmitSignal('fetch-submit');
        return originalFetch.apply(this, arguments);
      };

      const originalXHROpen = window.XMLHttpRequest.prototype.open;
      window.XMLHttpRequest.prototype.open = function(method, url, ...rest) {
        if (!resolved && isFormSubmitUrl(url)) recordSubmitSignal('xhr-submit');
        return originalXHROpen.call(this, method, url, ...rest);
      };

      document.addEventListener('submit', onSubmit, true);
      window.addEventListener('beforeunload', onBeforeUnload);
      window.addEventListener('pagehide', onPageHide);

      const timer = setTimeout(() => finish('timeout'), timeoutMs);
      cancelWatcher = () => finish('cancelled');
    });
    return { promise, cancel: () => cancelWatcher && cancelWatcher() };
  }

  function waitForSubmitOrNavigate(timeoutMs = 10000) {
    return startSubmitOrNavigateWatcher(timeoutMs).promise;
  }

  /**
   * 拦截表单提交请求（拦截 fetch/XHR），用于检测 AJAX 类型的评论提交
   * 返回一个 Promise，resolve(true) 表示检测到提交请求发出，resolve(false) 表示超时
   * @param {number} timeoutMs - 超时毫秒数
   */
  function setupAjaxSubmitDetection(timeoutMs = 10000) {
    return new Promise((resolve) => {
      let detected = false;
      const timer = setTimeout(() => {
        cleanup();
        resolve(false);
      }, timeoutMs);

      function cleanup() {
        clearTimeout(timer);
        document.removeEventListener('submit', onSubmit, true);
        if (window.XMLHttpRequest) {
          window.XMLHttpRequest.prototype.open = originalXHROpen;
        }
        if (window.fetch) {
          window.fetch = originalFetch;
        }
      }

      function onSubmit(e) {
        if (detected) return;
        detected = true;
        cleanup();
        resolve(true);
      }

      // 拦截原生 fetch
      const originalFetch = window.fetch;
      window.fetch = function(input, init) {
        if (!detected && isFormSubmitUrl(input)) {
          detected = true;
          cleanup();
          resolve(true);
        }
        return originalFetch.apply(this, arguments);
      };

      // 拦截 XMLHttpRequest
      const originalXHROpen = window.XMLHttpRequest.prototype.open;
      window.XMLHttpRequest.prototype.open = function(method, url, ...rest) {
        if (!detected && isFormSubmitUrl(url)) {
          detected = true;
          cleanup();
          resolve(true);
        }
        return originalXHROpen.call(this, method, url, ...rest);
      };

      // 监听表单 submit 事件（catch 所有未拦截到的表单）
      document.addEventListener('submit', onSubmit, true);
    });
  }

  /**
   * 判断 URL 是否可能是评论表单提交地址
   * 排除静态资源和图片，只拦截看起来像 API/表单提交的 URL
   */
  function isFormSubmitUrl(url) {
    if (!url) return false;
    const s = String(url).toLowerCase();
    // 排除静态资源和常见非提交地址
    const excludePatterns = [
      /\.(js|css|png|jpg|jpeg|gif|svg|ico|woff2?|ttf|eot|webp|mp4|webm|ogg|mp3|wav|zip|tar|gz)$/,
      /google-analytics|googletagmanager|doubleclick|facebook\.com\/tr|analytics|tracking|pixel/i,
      /\/wp-admin\/admin-ajax/,
    ];
    for (const p of excludePatterns) {
      if (p.test(s)) return false;
    }
    return true;
  }

  // 执行点击操作
  async function performClick(button) {
    console.log('[AutoComment] 找到提交按钮:', {
      tagName: button.tagName,
      type: button.type,
      id: button.id,
      className: button.className,
      name: button.name,
      value: button.value,
      text: button.textContent ? button.textContent.trim().substring(0, 50) : '',
      disabled: button.disabled
    });

    // 获取评论文本框内容用于确认
    const commentTextarea = findLikelyCommentTextarea({ allowGenericFallback: true });
    if (commentTextarea) {
      console.log('[AutoComment] 评论文本框内容:', commentTextarea.value ? commentTextarea.value.substring(0, 100) + '...' : '(空)');
    }

    if (!isButtonClickable(button)) {
      console.log('[AutoComment] 提交按钮不可见或被禁用');
      return { success: false, error: '提交按钮不可见或被禁用' };
    }

    function tryRequestSubmit(formEl, submitter) {
      if (!formEl) return false;
      if (typeof formEl.requestSubmit === 'function') {
        try {
          formEl.requestSubmit(submitter);
          return true;
        } catch (err) {
          console.log('[AutoComment] requestSubmit 失败:', err.message);
        }
      }
      return false;
    }

    function buildSubmitAttemptPlanLocal(formEl) {
      const hasForm = !!formEl;
      const hasRequestSubmit = !!(formEl && typeof formEl.requestSubmit === 'function');
      const plan = [];
      plan.push('button-click');
      plan.push('synthetic-pointer-click');
      if (hasForm && hasRequestSubmit) plan.push('request-submit');
      plan.push('fallback-dispatch-click');
      if (hasForm) plan.push('form-submit');
      return plan;
    }

    function withTimeout(promise, timeoutMs, label) {
      return new Promise((resolve, reject) => {
        let settled = false;
        const timer = setTimeout(() => {
          if (settled) return;
          settled = true;
          reject(new Error(`${label} timed out after ${timeoutMs}ms`));
        }, timeoutMs);
        Promise.resolve(promise).then((value) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          resolve(value);
        }).catch((error) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          reject(error);
        });
      });
    }

    function getPreClickLayoutWaitTimeoutMsLocal(input) {
      const source = input && typeof input === 'object' ? input : {};
      const timeout = Number(source.timeoutMs);
      if (!Number.isFinite(timeout)) return 250;
      return Math.min(1000, Math.max(50, Math.round(timeout)));
    }

    function waitForPreClickLayout(timeoutMs = 250) {
      const boundedTimeout = getPreClickLayoutWaitTimeoutMsLocal({ timeoutMs });
      return new Promise((resolve) => {
        let settled = false;
        const finish = (mode) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          resolve(mode);
        };
        const timer = setTimeout(() => finish('timeout-fallback'), boundedTimeout);
        if (typeof requestAnimationFrame !== 'function') {
          finish('no-request-animation-frame');
          return;
        }
        try {
          requestAnimationFrame(() => requestAnimationFrame(() => finish('animation-frame')));
        } catch (_) {
          finish('request-animation-frame-error');
        }
      });
    }

    async function markSubmitAttemptStarted(label) {
      try {
        if (typeof chrome === 'undefined' || !chrome.storage) return;
        const data = await new Promise((resolve) => chrome.storage.local.get(['batchSubmitCtx'], resolve));
        const ctx = data.batchSubmitCtx;
        if (!ctx || !_batchCtx || ctx.batchId !== _batchCtx.batchId || Number(ctx.urlIndex) !== Number(_batchCtx.urlIndex)) return;
        await new Promise((resolve) => {
          chrome.storage.local.set({
            batchSubmitCtx: {
              ...ctx,
              submitAttemptStarted: true,
              submitAttemptMethod: label,
              submitAttemptStartedAt: Date.now(),
              timestamp: Date.now()
            }
          }, resolve);
        });
      } catch (_) {}
    }

    async function triggerAndWaitForSubmit(label, triggerFn) {
      const submitWatcher = startSubmitOrNavigateWatcher(1800);
      try {
        logBatchSubmit('submit.attempt_start', { method: label });
        await markSubmitAttemptStarted(label);
        await withTimeout(triggerFn(), 2500, label);
        logBatchSubmit('submit.attempt_triggered', { method: label });
        recordFormSubmit();
        const submitResult = await submitWatcher.promise;
        const normalizedResult = submitResult === 'timeout' || submitResult === 'cancelled'
          ? 'clicked'
          : submitResult;
        logBatchSubmit('submit.attempt_done', {
          method: label,
          submitResult: normalizedResult
        });
        console.log('[AutoComment][submit-click] attempt completed', {
          label,
          submitResult: normalizedResult
        });
        return {
          success: true,
          button: button,
          submitResult: normalizedResult,
          submitMethod: label
        };
      } catch (err) {
        submitWatcher.cancel();
        logBatchSubmit('submit.attempt_failed', {
          method: label,
          error: err && err.message ? err.message : String(err)
        });
        throw err;
      }
    }

    async function runSubmitAttempt(label, formEl) {
      if (label === 'request-submit') {
        return await triggerAndWaitForSubmit(label, async () => {
          if (!tryRequestSubmit(formEl, button)) {
            throw new Error('requestSubmit unavailable or failed');
          }
        });
      }

      if (label === 'button-click') {
        return await triggerAndWaitForSubmit(label, async () => {
          button.click();
        });
      }

      if (label === 'synthetic-pointer-click') {
        return await triggerAndWaitForSubmit(label, async () => {
          const rect = button.getBoundingClientRect();
          const clientX = Math.round(rect.left + rect.width / 2);
          const clientY = Math.round(rect.top + rect.height / 2);
          const pointerOpts = {
            bubbles: true,
            cancelable: true,
            clientX,
            clientY,
            pointerId: 1,
            pointerType: 'mouse',
            isPrimary: true,
            view: window
          };
          if (typeof PointerEvent !== 'undefined') {
            button.dispatchEvent(new PointerEvent('pointerdown', pointerOpts));
            await new Promise(resolve => setTimeout(resolve, 20));
          }
          button.dispatchEvent(new MouseEvent('mousedown', { view: window, bubbles: true, cancelable: true, clientX, clientY }));
          await new Promise(resolve => setTimeout(resolve, 40));
          button.dispatchEvent(new MouseEvent('mouseup', { view: window, bubbles: true, cancelable: true, clientX, clientY }));
          await new Promise(resolve => setTimeout(resolve, 20));
          if (typeof PointerEvent !== 'undefined') {
            button.dispatchEvent(new PointerEvent('pointerup', pointerOpts));
            await new Promise(resolve => setTimeout(resolve, 20));
          }
          button.dispatchEvent(new MouseEvent('click', { view: window, bubbles: true, cancelable: true, clientX, clientY }));
        });
      }

      if (label === 'fallback-dispatch-click') {
        return await triggerAndWaitForSubmit(label, async () => {
          button.dispatchEvent(new MouseEvent('click', { view: window, bubbles: true, cancelable: true }));
        });
      }

      if (label === 'form-submit') {
        return await triggerAndWaitForSubmit(label, async () => {
          if (!formEl || typeof formEl.submit !== 'function') {
            throw new Error('form.submit unavailable');
          }
          formEl.submit();
        });
      }

      throw new Error(`unknown submit attempt: ${label}`);
    }

    try {
      // 长页面若用 smooth，滚动未完成时 getBoundingClientRect 会算错坐标，合成点击落空
      button.scrollIntoView({ behavior: 'auto', block: 'center', inline: 'nearest' });
      logBatchSubmit('submit.pre_click_wait_start', { timeoutMs: 250 });
      const preClickWaitMode = await waitForPreClickLayout(250);
      logBatchSubmit('submit.pre_click_wait_done', { mode: preClickWaitMode });
      await new Promise(resolve => setTimeout(resolve, 80));

      console.log('[AutoComment] 尝试点击提交按钮...');

      const formElForPlan = button.form || button.closest('form');
      const submitPlan = buildSubmitAttemptPlanLocal(formElForPlan);
      logBatchSubmit('submit.attempt_plan', {
        methods: submitPlan,
        formId: formElForPlan && formElForPlan.id ? formElForPlan.id : '',
        buttonId: button && button.id ? button.id : '',
        buttonName: button && button.name ? button.name : '',
        buttonType: button && button.type ? button.type : '',
        buttonText: button && button.textContent ? button.textContent.trim().slice(0, 80) : ''
      });

      let lastAttemptError = null;
      for (const method of submitPlan) {
        try {
          return await runSubmitAttempt(method, formElForPlan);
        } catch (error) {
          lastAttemptError = error;
        }
      }

      return {
        success: false,
        error: 'submit attempts failed: ' + (lastAttemptError && lastAttemptError.message ? lastAttemptError.message : 'unknown error')
      };

      const rect = button.getBoundingClientRect();
      const clientX = Math.round(rect.left + rect.width / 2);
      const clientY = Math.round(rect.top + rect.height / 2);

      const pointerOpts = {
        bubbles: true,
        cancelable: true,
        clientX,
        clientY,
        pointerId: 1,
        pointerType: 'mouse',
        isPrimary: true,
        view: window
      };

      try {
        const result = await triggerAndWaitForSubmit('synthetic-pointer-click', async () => {
          if (typeof PointerEvent !== 'undefined') {
            button.dispatchEvent(new PointerEvent('pointerdown', pointerOpts));
            await new Promise(resolve => setTimeout(resolve, 20));
          }

          button.dispatchEvent(new MouseEvent('mousedown', {
            view: window,
            bubbles: true,
            cancelable: true,
            clientX,
            clientY
          }));
          await new Promise(resolve => setTimeout(resolve, 40));

          button.dispatchEvent(new MouseEvent('mouseup', {
            view: window,
            bubbles: true,
            cancelable: true,
            clientX,
            clientY
          }));
          await new Promise(resolve => setTimeout(resolve, 20));

          if (typeof PointerEvent !== 'undefined') {
            button.dispatchEvent(new PointerEvent('pointerup', pointerOpts));
            await new Promise(resolve => setTimeout(resolve, 20));
          }

          button.dispatchEvent(new MouseEvent('click', {
            view: window,
            bubbles: true,
            cancelable: true,
            clientX,
            clientY
          }));
        });

        console.log('[AutoComment] 提交按钮点击成功 (pointer/mousedown→mouseup→click)');
        return result;
      } catch (e) {
        console.log('[AutoComment] 合成事件失败，尝试 button.click():', e.message);
        try {
          const result = await triggerAndWaitForSubmit('button-click', async () => {
            button.click();
          });
          console.log('[AutoComment] button.click() 点击成功');
          return result;
        } catch (e2) {
          console.log('[AutoComment] button.click() 也失败:', e2.message);

          const formEl = button.form || button.closest('form');
          try {
            const result = await triggerAndWaitForSubmit('request-submit', async () => {
              if (!tryRequestSubmit(formEl, button)) {
                throw new Error('requestSubmit unavailable or failed');
              }
            });
            console.log('[AutoComment] form.requestSubmit(submitter) 成功');
            return result;
          } catch (requestSubmitError) {
            console.log('[AutoComment] form.requestSubmit(submitter) failed:', requestSubmitError.message);
          }
          try {
            if (formEl) {
              console.log('[AutoComment] 降级 form.submit()（无 submit 事件）');
              return await triggerAndWaitForSubmit('form-submit', async () => {
                formEl.submit();
              });
            }
          } catch (e3) {
            console.log('[AutoComment] 表单提交也失败:', e3.message);
          }

          return { success: false, error: '点击按钮失败: ' + e2.message };
        }
      }
    } catch (e) {
      console.log('[AutoComment] 直接点击失败:', e.message);

      try {
        const event = new MouseEvent('click', {
          view: window,
          bubbles: true,
          cancelable: true
        });
        const result = await triggerAndWaitForSubmit('fallback-dispatch-click', async () => {
          button.dispatchEvent(event);
        });
        console.log('[AutoComment] 使用 dispatchEvent 点击成功');
        return result;
      } catch (e2) {
        console.log('[AutoComment] dispatchEvent 点击也失败:', e2.message);

        const formEl = button.form || button.closest('form');
        try {
          const result = await triggerAndWaitForSubmit('fallback-request-submit', async () => {
            if (!tryRequestSubmit(formEl, button)) {
              throw new Error('requestSubmit unavailable or failed');
            }
          });
          console.log('[AutoComment] form.requestSubmit(submitter) 成功');
          return result;
        } catch (requestSubmitError) {
          console.log('[AutoComment] fallback form.requestSubmit(submitter) failed:', requestSubmitError.message);
        }
        try {
          if (formEl) {
            console.log('[AutoComment] 尝试 form.submit()');
            return await triggerAndWaitForSubmit('fallback-form-submit', async () => {
              formEl.submit();
            });
          }
        } catch (e3) {
          console.log('[AutoComment] 表单提交失败:', e3.message);
        }

        return { success: false, error: '点击按钮失败: ' + e.message };
      }
    }
  }

  function tryFillCommentTextareaWithPromotion(promotionText, preferredTextarea = null, options = {}) {
    if (!promotionText) {
      console.log('[AutoComment] no promotion copy to fill');
      return false;
    }

    const targetTextarea = preferredTextarea || findLikelyCommentTextarea({ allowGenericFallback: true });
    if (!targetTextarea) {
      console.log('[AutoComment] comment textarea not found, cannot fill copy');
      return false;
    }

    console.log('[AutoComment] filling comment textarea:', {
      name: targetTextarea.name,
      id: targetTextarea.id,
      className: targetTextarea.className,
      currentLength: getCommentFieldText(targetTextarea).length
    });

    return fillSpecificCommentTextarea(targetTextarea, promotionText, options);
  }

  async function tryFillCommentTextareaWithPromotionHumanLike(promotionText, preferredTextarea = null, options = {}) {
    if (!promotionText) {
      console.log('[AutoComment] no promotion copy to fill');
      return {
        success: false,
        chars: 0,
        durationMs: 0,
        plannedDelayMs: 0,
        avgDelayMs: 0,
        strategy: normalizeTypingStrategyLocal(options.strategy || options.typingStrategy),
        error: 'empty_text'
      };
    }

    const targetTextarea = preferredTextarea || findLikelyCommentTextarea({ allowGenericFallback: true });
    if (!targetTextarea) {
      console.log('[AutoComment] comment textarea not found, cannot fill copy');
      return {
        success: false,
        chars: 0,
        durationMs: 0,
        plannedDelayMs: 0,
        avgDelayMs: 0,
        strategy: normalizeTypingStrategyLocal(options.strategy || options.typingStrategy),
        error: 'missing_textarea'
      };
    }

    console.log('[AutoComment] human-like filling comment textarea:', {
      name: targetTextarea.name,
      id: targetTextarea.id,
      className: targetTextarea.className,
      currentLength: getCommentFieldText(targetTextarea).length,
      typingStrategy: normalizeTypingStrategyLocal(options.strategy || options.typingStrategy)
    });

    return await fillSpecificCommentTextareaHumanLike(targetTextarea, promotionText, options);
  }

  function assertCommentReadyForSubmit(expectedText, preferredForm = null, preferredTextarea = null, promotionUrl = '') {
    const form = preferredForm || findCommentForm();
    const expected = String(expectedText || '').trim();
    let textarea = preferredTextarea || null;
    if (form) {
      const formTextarea = getCommentTextareaFromForm(form) || form.querySelector('textarea');
      if (formTextarea && formTextarea !== preferredTextarea) {
        const preferredValue = getCommentFieldText(preferredTextarea);
        const preferredHtml = getCommentFieldHtml(preferredTextarea);
        const preferredValidation = validateCommentReadyForSubmitLocal({
          expectedText: expected,
          actualText: preferredValue,
          actualHtml: preferredHtml,
          promotionUrl
        });
        const fallbackValue = getCommentFieldText(formTextarea);
        const fallbackHtml = getCommentFieldHtml(formTextarea);
        const fallbackValidation = validateCommentReadyForSubmitLocal({
          expectedText: expected,
          actualText: fallbackValue,
          actualHtml: fallbackHtml,
          promotionUrl
        });
        logBatchSubmit('submit.textarea_choice', {
          choice: preferredValidation.ok ? 'preferred' : 'form',
          preferredId: preferredTextarea && preferredTextarea.id ? preferredTextarea.id : '',
          preferredName: preferredTextarea && preferredTextarea.name ? preferredTextarea.name : '',
          preferredLength: preferredValue.length,
          preferredReady: preferredValidation.ok,
          preferredReason: preferredValidation.reason,
          fallbackId: formTextarea && formTextarea.id ? formTextarea.id : '',
          fallbackName: formTextarea && formTextarea.name ? formTextarea.name : '',
          fallbackLength: fallbackValue.length,
          fallbackReady: fallbackValidation.ok,
          fallbackReason: fallbackValidation.reason
        });
        if (!preferredValidation.ok) textarea = formTextarea;
      } else if (formTextarea) {
        textarea = formTextarea;
      }
    }
    if (!textarea) {
      textarea = findLikelyCommentTextarea({ allowGenericFallback: true });
    }

    const value = getCommentFieldText(textarea);
    const html = getCommentFieldHtml(textarea);
    const validation = validateCommentReadyForSubmitLocal({
      expectedText: expected,
      actualText: value,
      actualHtml: html,
      promotionUrl
    });
    console.log('[AutoComment] pre-submit comment check:', {
      hasForm: !!form,
      hasTextarea: !!textarea,
      valueLen: value.length,
      htmlLen: html.length,
      expectedLen: expected.length,
      textareaId: textarea && textarea.id,
      textareaName: textarea && textarea.name,
      ready: validation.ok,
      reason: validation.reason,
      hostFound: validation.hostFound,
      promotionHost: validation.promotionHost
    });

    if (!expected || expected.length < 10) {
      throw new Error('AI comment content is empty before submit');
    }
    if (!textarea || value.length < 5) {
      throw new Error('comment textarea is empty before submit');
    }
    if (!validation.ok) {
      logBatchSubmit('submit.ready_check_failed', validation);
      throw new Error('comment textarea is not ready before submit: ' + validation.reason);
    }
    return validation;
  }

  async function ensureCommentReadyForSubmitWithRecovery(expectedText, preferredForm = null, preferredTextarea = null, promotionUrl = '', fillOptions = {}, stagePrefix = 'submit.ready') {
    let textarea = preferredTextarea || findLikelyCommentTextarea({ allowGenericFallback: true });
    let lastError = null;

    for (let attempts = 0; attempts < 3; attempts++) {
      try {
        const validation = assertCommentReadyForSubmit(expectedText, preferredForm, textarea, promotionUrl);
        logBatchSubmit(`${stagePrefix}_check_done`, {
          ...validation,
          recoveryAttempts: attempts,
          recoveryAction: chooseCommentReadyRecoveryActionLocal({ ready: true, attempts })
        });
        return validation;
      } catch (error) {
        lastError = error;
        const currentText = getCommentFieldText(textarea);
        const currentHtml = getCommentFieldHtml(textarea);
        const validation = validateCommentReadyForSubmitLocal({
          expectedText,
          actualText: currentText,
          actualHtml: currentHtml,
          promotionUrl
        });
        const action = chooseCommentReadyRecoveryActionLocal({
          ready: validation.ok,
          attempts
        });
        logBatchSubmit(`${stagePrefix}_check_failed`, {
          ...validation,
          recoveryAttempts: attempts,
          recoveryAction: action,
          error: error && error.message ? error.message : String(error || '')
        });

        if (action === 'segmented_refill') {
          textarea = textarea || findLikelyCommentTextarea({ allowGenericFallback: true });
          const retryFillResult = await fillSpecificCommentTextareaHumanLike(textarea, expectedText, fillOptions);
          logBatchSubmit(`${stagePrefix}_segmented_refill_done`, {
            success: !!(retryFillResult && retryFillResult.success),
            strategy: retryFillResult && retryFillResult.strategy ? retryFillResult.strategy : '',
            chars: retryFillResult && Number.isFinite(retryFillResult.chars) ? retryFillResult.chars : 0,
            durationMs: retryFillResult && Number.isFinite(retryFillResult.durationMs) ? retryFillResult.durationMs : 0,
            error: retryFillResult && retryFillResult.error ? retryFillResult.error : '',
            filledLength: textarea ? getCommentFieldText(textarea).length : 0
          });
          await new Promise(resolve => setTimeout(resolve, 150));
          continue;
        }

        if (action === 'direct_set_value') {
          textarea = textarea || findLikelyCommentTextarea({ allowGenericFallback: true });
          const directFilled = fillSpecificCommentTextarea(textarea, expectedText);
          logBatchSubmit(`${stagePrefix}_direct_refill_done`, {
            success: !!directFilled,
            filledLength: textarea ? getCommentFieldText(textarea).length : 0
          });
          await new Promise(resolve => setTimeout(resolve, 150));
          continue;
        }

        break;
      }
    }

    throw lastError || new Error('comment textarea is not ready before submit');
  }

  async function findCommentTargetsForBatchUsingManualFlow(timeoutMs = 12000) {
    const start = Date.now();
    let hasTriggeredFlow = false;
    let lastForm = null;
    let lastTextarea = null;

    while (Date.now() - start < timeoutMs) {
      lastForm = findCommentForm();
      lastTextarea = findLikelyCommentTextarea({ allowGenericFallback: true });

      if (lastForm && lastTextarea) {
        console.log('[content] BATCH_HANDLE 手动按钮同款找框成功:', {
          formId: lastForm.id,
          formClass: lastForm.className,
          textareaName: lastTextarea.name,
          textareaId: lastTextarea.id
        });
        return { form: lastForm, textarea: lastTextarea };
      }

      if (!hasTriggeredFlow) {
        hasTriggeredFlow = true;
        console.log('[content] BATCH_HANDLE 使用手动按钮同款流程触发评论表单展开...');
        await triggerCommentFormFlowForBatch(Math.min(8000, Math.max(1000, timeoutMs - (Date.now() - start))));
      }

      await new Promise(resolve => setTimeout(resolve, 800));
    }

    console.log('[content] BATCH_HANDLE 手动按钮同款找框超时:', {
      hasForm: !!lastForm,
      hasTextarea: !!lastTextarea
    });
    return { form: lastForm, textarea: lastTextarea };
  }

  function focusCommentTextareaWithPromotion(promotionText) {
    const targetTextarea = findLikelyCommentTextarea({ allowGenericFallback: true });
    if (!targetTextarea) {
      console.log('[AutoComment] 未找到评论文本框，无法聚焦');
      return;
    }

    // 如果文本框为空且有推广文案，先填入
    const current = (targetTextarea.value || '').trim();
    if (!current && promotionText) {
      setValue(targetTextarea, promotionText);
    }

    try {
      targetTextarea.focus();
      const len = targetTextarea.value.length;
      if (typeof targetTextarea.setSelectionRange === 'function') {
        targetTextarea.setSelectionRange(len, len);
      }
      if (typeof targetTextarea.scrollIntoView === 'function') {
        targetTextarea.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    } catch (e) {
      console.log('[AutoComment] 聚焦文本框失败:', e.message);
    }
  }

  // ============================================================
  //  确保评论表单所有必填字段都被正确填入，并在提交前验证
  // ============================================================
  async function ensureAllCommentFormFieldsFilled(commentText, skipCommentValidation = false) {
    const userProfile = await getUserProfile();
    const WEBSITE = await getWebsiteUrl();
    const USERNAME = userProfile.name || '';
    const EMAIL = userProfile.email || '';

    console.log('[AutoComment] ===== ensureAllCommentFormFieldsFilled 开始 =====');
    console.log('[AutoComment] 将填入 - Name:', USERNAME, '| Email:', EMAIL, '| Website:', WEBSITE, '| skipComment:', skipCommentValidation);

    // ── 前置检查：配置缺失则直接报错，不静默失败 ─────────────────
    if (!USERNAME || !EMAIL) {
      const missing = [];
      if (!USERNAME) missing.push('姓名（Name）');
      if (!EMAIL) missing.push('邮箱（Email）');
      const msg = '请先在扩展选项页填写' + missing.join('和') + '，否则无法自动提交评论！';
      console.error('[AutoComment] ' + msg);
      // 通过 status 提示用户
      setStatus(msg, '#f97373');
      return { success: false, missingFields: ['name config missing', 'email config missing'] };
    }

    // ── 步骤1：找到表单 ──────────────────────────────────────
    let form = null;

    // 方法A：直接用 WordPress 标准 form 选择器
    const formSelectors = [
      '#commentform',
      '.comment-form',
      '.commentform',
      'form[name="commentform"]',
      'form[id="commentform"]',
      'form[class*="comment-form"]',
      'form[id*="comment-form"]'
    ];
    for (const sel of formSelectors) {
      try {
        const el = document.querySelector(sel);
        if (el && el.tagName === 'FORM') {
          form = el;
          console.log('[AutoComment] 通过选择器找到表单:', sel);
          break;
        }
      } catch (_) {}
    }

    // 方法B：先找 textarea，再用 ta.form / closest('form')
    if (!form) {
      const textarea = findLikelyCommentTextarea({ allowGenericFallback: true });
      if (textarea) {
        console.log('[AutoComment] 找到评论 textarea:', {
          name: textarea.name,
          id: textarea.id,
          className: textarea.className,
          tagName: textarea.tagName,
          formAttr: textarea.form ? textarea.form.id || textarea.form.className : 'null'
        });
        // textarea.form 在大多数现代浏览器中会返回关联的表单元素
        if (textarea.form) {
          form = textarea.form;
          console.log('[AutoComment] 通过 textarea.form 找到表单');
        } else if (textarea.closest) {
          const parentForm = textarea.closest('form');
          if (parentForm) {
            form = parentForm;
            console.log('[AutoComment] 通过 textarea.closest("form") 找到表单');
          }
        }
      }
    }

    // 方法C：在评论区域附近找 form
    if (!form) {
      const areaSelectors = [
        '#comments', '#respond', '.comment-respond',
        '#comments-section', '.comments-area', '.comment-section'
      ];
      for (const sel of areaSelectors) {
        const area = document.querySelector(sel);
        if (area) {
          const f = area.querySelector('form') || (area.closest ? area.closest('form') : null);
          if (f) {
            form = f;
            console.log('[AutoComment] 通过评论区域找到表单:', sel);
            break;
          }
        }
      }
    }

    // 方法D：直接找页面所有表单中含 comment/respond 关键词的
    if (!form) {
      const allForms = Array.from(document.querySelectorAll('form'));
      for (const f of allForms) {
        const text = safeLowerStringLocal(f.textContent || '');
        const cls = safeLowerStringLocal(f.className || '');
        const fid = safeLowerStringLocal(f.id || '');
        if (text.includes('comment') || text.includes('respond') ||
            cls.includes('comment') || fid.includes('comment') ||
            cls.includes('respond') || fid.includes('respond')) {
          form = f;
          console.log('[AutoComment] 通过关键词找到表单:', f.id, f.className);
          break;
        }
      }
    }

    if (!form) {
      console.log('[AutoComment] 未能找到评论表单!');
      return { success: false, missingFields: ['form not found'] };
    }

    console.log('[AutoComment] 最终使用的表单:', {
      id: form.id,
      className: form.className,
      action: form.action
    });

    // ── 步骤2：统计表单中所有输入框（用于日志）───────────────
    const formAllInputs = Array.from(form.querySelectorAll('input'));
    const formTextareas = Array.from(form.querySelectorAll('textarea'));
    console.log('[AutoComment] 表单中的 input 数量:', formAllInputs.length, 'textarea 数量:', formTextareas.length);
    console.log('[AutoComment] 表单中所有 input:', formAllInputs.map(i => ({
      name: i.name, id: i.id, type: i.type, className: i.className,
      placeholder: i.placeholder, valueLen: (i.value || '').length
    })));

    // ── 步骤3：找评论 textarea ───────────────────────────────
    let commentTextarea = null;
    if (formTextareas.length > 0) {
      // 优先找有 comment 关键词的
      commentTextarea = formTextareas.find(ta => {
        const n = (ta.name || '').toLowerCase();
        const i = (ta.id || '').toLowerCase();
        return n.includes('comment') || i.includes('comment');
      }) || formTextareas[0];
    }
    if (!commentTextarea) {
      // 再从全局找并验证属于当前表单
      const ta = findLikelyCommentTextarea({ allowGenericFallback: true });
      if (ta && (ta.form === form || (ta.closest && ta.closest('form') === form))) {
        commentTextarea = ta;
      }
    }

    if (!commentTextarea) {
      console.log('[AutoComment] 未找到评论 textarea!');
      return { success: false, missingFields: ['comment textarea not found'] };
    }

    // ── 步骤4：找 Name 输入框 ─────────────────────────────────
    // 直接选择器 + closest 验证（不依赖 formInputs 集合，避免遗漏嵌套字段）
    let nameInput = null;
    const nameSelectors = [
      '#author', 'input[name="author"]',
      'input[id*="author" i]', 'input[class*="author" i]',
      'input[name="name"]', 'input[name="your-name"]',
      'input[id="name"]', 'input[id="author-name"]',
      'input[placeholder*="name" i]', 'input[placeholder*="姓名" i]',
      'input[placeholder*="昵称" i]', 'input[placeholder*="名字" i]'
    ];
    for (const sel of nameSelectors) {
      try {
        const el = form.querySelector(sel);
        if (el && el.tagName === 'INPUT' && el.closest('form') === form) {
          nameInput = el;
          console.log('[AutoComment] 通过选择器找到 nameInput:', sel, { name: nameInput.name, id: nameInput.id, type: nameInput.type });
          break;
        }
      } catch (_) {}
    }
    if (nameInput) {
      console.log('[AutoComment] 找到 nameInput:', { name: nameInput.name, id: nameInput.id, type: nameInput.type });
    } else {
      console.log('[AutoComment] 未找到 nameInput!');
    }

    // ── 步骤5：找 Email 输入框 ───────────────────────────────
    let emailInput = null;
    const emailSelectors = [
      '#email', 'input[name="email"]', 'input[type="email"]',
      'input[id="mail"]', 'input[name="mail"]',
      'input[id*="email" i]', 'input[class*="email" i]',
      'input[name="your-email"]', 'input[name="your_mail"]',
      'input[placeholder*="email" i]', 'input[placeholder*="邮箱" i]',
      'input[placeholder*="mail" i]', 'input[placeholder*="e-mail" i]'
    ];
    for (const sel of emailSelectors) {
      try {
        const el = form.querySelector(sel);
        if (el && el.tagName === 'INPUT' && el.closest('form') === form) {
          emailInput = el;
          console.log('[AutoComment] 通过选择器找到 emailInput:', sel, { name: emailInput.name, id: emailInput.id, type: emailInput.type });
          break;
        }
      } catch (_) {}
    }
    if (emailInput) {
      console.log('[AutoComment] 找到 emailInput:', { name: emailInput.name, id: emailInput.id, type: emailInput.type });
    } else {
      console.log('[AutoComment] 未找到 emailInput!');
    }

    // ── 步骤6：找 Website 输入框 ─────────────────────────────
    let websiteInput = null;
    const urlSelectors = [
      '#url', 'input[name="url"]', 'input[type="url"]',
      'input[id="website"]', 'input[name="website"]',
      'input[placeholder*="website" i]', 'input[placeholder*="网站" i]',
      'input[placeholder*="url" i]'
    ];
    for (const sel of urlSelectors) {
      try {
        const el = form.querySelector(sel);
        if (el && el.tagName === 'INPUT' && el.closest('form') === form) {
          websiteInput = el;
          console.log('[AutoComment] 通过选择器找到 websiteInput:', sel);
          break;
        }
      } catch (_) {}
    }
    if (websiteInput) {
      console.log('[AutoComment] 找到 websiteInput:', { name: websiteInput.name, id: websiteInput.id, type: websiteInput.type });
    } else {
      console.log('[AutoComment] 未找到 websiteInput（可选）');
    }

    // ── 步骤7：填入所有字段 ─────────────────────────────────
    console.log('[AutoComment] 开始填入字段...');

    if (nameInput) {
      setValueRobust(nameInput, USERNAME);
    }
    if (emailInput) {
      setValueRobust(emailInput, EMAIL);
    }
    if (websiteInput && WEBSITE) {
      setValue(websiteInput, WEBSITE);
    }
    if (commentText && commentTextarea) {
      // 检测是否是 wpDiscuz 编辑器
      if (commentTextarea._isWpDiscuz) {
        setValueForEditableDiv(commentTextarea._realElement, commentText);
      } else {
        setValue(commentTextarea, commentText);
      }
    }

    // ── 步骤8：等待 DOM 更新后验证 ───────────────────────────
    await new Promise(resolve => setTimeout(resolve, 150));

    const missingFields = [];
    const validationLog = {};

    // 验证 comment（预检查时跳过，因为文案尚未生成）
    // 注意：如果是 wpDiscuz，需要从 _realElement 获取 textContent
    const cv = commentTextarea._isWpDiscuz 
      ? (commentTextarea._realElement.textContent || '').trim()
      : (commentTextarea.value || '').trim();
    validationLog.comment = { filled: cv.length > 0, length: cv.length, isWpDiscuz: !!commentTextarea._isWpDiscuz };
    if (!skipCommentValidation && (!cv || cv.length < 5)) {
      missingFields.push('comment');
    }

    // 验证 name（某些网站不强制要求姓名，不影响提交）
    if (nameInput) {
      const nv = (nameInput.value || '').trim();
      validationLog.name = { filled: nv.length > 0, value: nv.substring(0, 20) };
    } else {
      validationLog.name = { found: false, optional: true };
    }

    // 验证 email（某些网站（如 Jetpack、Disqus）不强制要求邮箱，不影响提交）
    if (emailInput) {
      const ev = (emailInput.value || '').trim();
      validationLog.email = { filled: ev.length > 0, value: ev.substring(0, 20) };
    } else {
      validationLog.email = { found: false, optional: true };
    }

    // 验证 website（可选，不影响提交）
    if (websiteInput) {
      validationLog.website = { filled: !!(websiteInput.value || '').trim() };
    }

    console.log('[AutoComment] 字段验证结果:', validationLog);
    console.log('[AutoComment] 缺失字段:', missingFields);
    console.log('[AutoComment] ===== ensureAllCommentFormFieldsFilled 结束 =====');

    return { success: missingFields.length === 0, missingFields };
  }

  // 收集当前页面内容 + 调用后端生成推广文案
  function extractAnchorTextsFromCopy(text) {
    const anchors = [];
    const source = String(text || '');
    const anchorRe = /<a\b[^>]*>([\s\S]*?)<\/a>/gi;
    let match;
    while ((match = anchorRe.exec(source)) !== null) {
      const label = String(match[1] || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
      if (label) anchors.push(label);
    }
    return anchors;
  }

  async function getUsedAnchorTextsForCurrentBatch() {
    const batchId = _batchCtx && _batchCtx.batchId ? _batchCtx.batchId : '';
    if (!batchId || typeof chrome === 'undefined' || !chrome.storage || !chrome.storage.local) return [];
    const data = await new Promise((resolve) => chrome.storage.local.get(['batchResults'], resolve));
    const results = Array.isArray(data.batchResults) ? data.batchResults : [];
    const used = [];
    for (const record of results) {
      if (!record || record.batchId !== batchId) continue;
      if (record.anchorText) used.push(record.anchorText);
      used.push(...extractAnchorTextsFromCopy(record.aiContent));
    }
    return Array.from(new Set(used.map((item) => String(item || '').trim()).filter(Boolean)));
  }

  function buildRecentAnchorTextStatsLocal(records, promotionWebsiteUrl, now = Date.now(), windowMs = 48 * 60 * 60 * 1000) {
    const source = Array.isArray(records) ? records : [];
    const targetKey = normalizePromotionWebsiteKey(promotionWebsiteUrl);
    const counts = new Map();
    for (const record of source) {
      if (!record || typeof record !== 'object') continue;
      if (targetKey && normalizePromotionWebsiteKey(record.promotionWebsiteUrl) !== targetKey) continue;
      const timestamp = typeof record.timestamp === 'number' ? record.timestamp : Date.parse(String(record.timestamp || record.createdAt || ''));
      if (!timestamp || now - timestamp > windowMs || timestamp > now + 60000) continue;
      const anchors = [];
      if (record.anchorText) anchors.push(record.anchorText);
      anchors.push(...extractAnchorTextsFromCopy(record.aiContent));
      for (const anchor of anchors) {
        const text = String(anchor || '').replace(/\s+/g, ' ').trim();
        if (!text) continue;
        const key = text.toLowerCase();
        const current = counts.get(key) || { text, count: 0 };
        current.count += 1;
        counts.set(key, current);
      }
    }
    return Array.from(counts.values()).sort((a, b) => b.count - a.count || a.text.localeCompare(b.text));
  }

  async function getRecentAnchorTextStatsForPromotion(promotionWebsiteUrl) {
    if (typeof chrome === 'undefined' || !chrome.storage || !chrome.storage.local) return [];
    const data = await new Promise((resolve) => chrome.storage.local.get(['batchResults'], resolve));
    return buildRecentAnchorTextStatsLocal(data && data.batchResults, promotionWebsiteUrl);
  }

  function createAiRequestId() {
    const batchId = _batchCtx && _batchCtx.batchId ? _batchCtx.batchId : 'manual';
    const urlIndex = _batchCtx && Number.isFinite(Number(_batchCtx.urlIndex)) ? _batchCtx.urlIndex : 'na';
    const rand = Math.random().toString(36).slice(2, 8);
    return `${batchId}:${urlIndex}:${Date.now()}:${rand}`;
  }

  function getPageLanguagePayload(title, description) {
    const htmlLang = document.documentElement && document.documentElement.lang
      ? document.documentElement.lang
      : '';
    const headings = Array.from(document.querySelectorAll('h1, h2'))
      .slice(0, 6)
      .map((node) => String(node.innerText || node.textContent || '').replace(/\s+/g, ' ').trim())
      .filter(Boolean);
    const evidence = [
      htmlLang ? `html.lang=${htmlLang}` : '',
      title ? `title=${String(title).slice(0, 180)}` : '',
      description ? `description=${String(description).slice(0, 220)}` : '',
      headings.length ? `headings=${headings.join(' | ').slice(0, 360)}` : ''
    ].filter(Boolean).join('\n');
    return {
      pageLanguageHint: htmlLang || '',
      pageLanguageEvidence: evidence
    };
  }

  function cancelAiRequest(aiRequestId, reason) {
    const requestId = String(aiRequestId || '').trim();
    if (!requestId) return Promise.resolve(null);
    const payload = JSON.stringify({ aiRequestId: requestId, reason: reason || 'client_cancel' });
    const endpoint = `${QWEN_API_BASE}/generate-copy/cancel`;
    try {
      if (navigator && typeof navigator.sendBeacon === 'function') {
        const blob = new Blob([payload], { type: 'application/json' });
        navigator.sendBeacon(endpoint, blob);
        return Promise.resolve({ beacon: true });
      }
    } catch (error) {
      console.warn('[content] AI cancel beacon failed:', error && error.message ? error.message : error);
    }
    return fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: payload,
      keepalive: true
    }).catch((error) => {
      console.warn('[content] AI cancel request failed:', error && error.message ? error.message : error);
      return null;
    });
  }

  function cancelActiveAiRequest(reason) {
    const requestId = activeAiRequestId;
    activeAiRequestId = '';
    return cancelAiRequest(requestId, reason);
  }

  window.addEventListener('pagehide', () => {
    cancelActiveAiRequest('pagehide');
  });
  window.addEventListener('beforeunload', () => {
    cancelActiveAiRequest('beforeunload');
  });

  async function generatePromotionCopyWithQwen() {
    const QWEN_SKILL_TEMPLATE = await getQwenSkillTemplate();
    const [promotionWebsiteUrl, promotionWebsiteContent, usedAnchorTexts] = await Promise.all([
      getWebsiteUrl(),
      getWebsiteContent(),
      getUsedAnchorTextsForCurrentBatch()
    ]);
    const usedAnchorTextStats = await getRecentAnchorTextStatsForPromotion(promotionWebsiteUrl);

    // 检查用户ID是否配置
    const userId = await getUserId();
    if (!userId) {
      throw new Error('User ID is not configured. Please set it on the extension options page.');
    }

    // Local-only mode: points consumption is disabled, so balance does not block generation.

    const websiteUrl = window.location.href || '';
    const title = document.title || '';
    const descriptionMeta =
      document.querySelector('meta[name="description"]') ||
      document.querySelector('meta[name="Description"]');
    const description = descriptionMeta ? descriptionMeta.content || '' : '';
    const languagePayload = getPageLanguagePayload(title, description);

    let bodyText = '';
    if (document.body) {
      bodyText = document.body.innerText || '';
      bodyText = bodyText.replace(/\s+/g, ' ').trim();
      const MAX_LEN = 4000;
      if (bodyText.length > MAX_LEN) {
        bodyText = bodyText.slice(0, MAX_LEN) + ' …（内容已截断）';
      }
    }

    const aiRequestId = createAiRequestId();
    activeAiRequestId = aiRequestId;
    console.info('[content][api] POST /generate-copy', {
      aiRequestId,
      userId,
      pageUrl: websiteUrl,
      titleLength: title.length,
      bodyTextLength: bodyText.length,
      usedAnchorCount: usedAnchorTexts.length,
      recentAnchorTextCount: usedAnchorTextStats.length,
      pageLanguageHint: languagePayload.pageLanguageHint
    });
    const controller = new AbortController();
    const timeoutId = setTimeout(() => {
      controller.abort();
      cancelAiRequest(aiRequestId, 'client_timeout');
    }, AI_COPY_REQUEST_TIMEOUT_MS);
    let response;
    try {
      response = await fetch(`${QWEN_API_BASE}/generate-copy`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          userId,
          websiteUrl,
          title,
          description,
          bodyText,
          promotionWebsiteUrl,
          promotionWebsiteContent,
          usedAnchorTexts,
          usedAnchorTextStats,
          aiRequestId,
          pageLanguageHint: languagePayload.pageLanguageHint,
          pageLanguageEvidence: languagePayload.pageLanguageEvidence,
          skillTemplate: QWEN_SKILL_TEMPLATE
        })
      });
    } catch (error) {
      if (error && error.name === 'AbortError') {
        throw new Error('AI copy generation request timed out');
      }
      throw error;
    } finally {
      clearTimeout(timeoutId);
      if (activeAiRequestId === aiRequestId) {
        activeAiRequestId = '';
      }
    }

    const data = await response.json();

    if (!response.ok || !data.success) {
      const msg = data && data.error
        ? `生成失败: ${data.error}`
        : '后端返回异常，请稍后重试。';
      throw new Error(msg);
    }

    const aiText = Object.prototype.hasOwnProperty.call(data, 'text')
      ? String(data.text || '').trim()
      : '';

    console.log('[AutoComment] AI copy generated length:', aiText.length);
    if (data.anchorText || data.anchorRewritten) {
      console.log('[AutoComment] AI promotion anchor:', {
        anchorText: data.anchorText || '',
        anchorSource: data.anchorSource || '',
        anchorWasDuplicate: !!data.anchorWasDuplicate,
        anchorRewritten: !!data.anchorRewritten,
        hrefNewlinePreserved: !!data.hrefNewlinePreserved
      });
    }
    lastGeneratedPromotionCopy = aiText;
    lastGeneratedPromotionCopyKey = await getGenerationCacheKey();
    return aiText;
  }

  // ====== 页面内浮动窗口 UI ======
  let qwenPanelEl = null;
  let qwenProgressTimer = null;

  function formatCompactBatchEtaLocal(ms) {
    const value = Number(ms);
    if (!Number.isFinite(value) || value < 0) return '估算中';
    const minutes = Math.max(1, Math.ceil(value / 60000));
    if (minutes < 60) return `约 ${minutes} 分钟后`;
    const hours = Math.floor(minutes / 60);
    const rest = minutes % 60;
    return rest > 0 ? `约 ${hours} 小时 ${rest} 分钟后` : `约 ${hours} 小时后`;
  }

  function buildCompactBatchProgressLocal(snapshot, now = Date.now()) {
    if (!snapshot || typeof snapshot !== 'object' || (!snapshot.batchId && !snapshot.totalCount)) {
      return { isBatch: false };
    }
    const total = Math.max(0, Number(snapshot.totalCount || 0));
    const completedSource = Number.isFinite(Number(snapshot.localResultCount))
      ? Number(snapshot.localResultCount)
      : (Number.isFinite(Number(snapshot.completedCount))
        ? Number(snapshot.completedCount)
        : (Array.isArray(snapshot.localResults) ? snapshot.localResults.length : 0));
    const completed = Math.min(total, Math.max(0, completedSource));
    const success = Math.max(0, Number(snapshot.successCount || 0));
    const currentRaw = Number(snapshot.currentIndex || 0);
    const current = total > 0 ? Math.min(total, Math.max(1, currentRaw)) : 0;
    const percent = total > 0 ? Math.round((completed / total) * 100) : 0;
    const status = String(snapshot.status || 'idle');
    const startedAt = Number(snapshot.batchStartedAt || snapshot.startedAt || 0);
    let etaText = '估算中';
    if (status === 'completed' || (total > 0 && completed >= total)) {
      etaText = '已完成';
    } else if (startedAt > 0 && completed > 0 && total > completed) {
      const elapsedMs = Math.max(0, Number(now || Date.now()) - startedAt);
      etaText = formatCompactBatchEtaLocal((elapsedMs / completed) * (total - completed));
    }
    return {
      isBatch: true,
      status,
      total,
      completed,
      success,
      current,
      percent,
      etaText,
      stageText: status === 'running'
        ? '正在处理当前页面'
        : (status === 'terminated' ? '任务已暂停' : (status === 'completed' ? '任务已完成' : '等待开始'))
    };
  }

  function chooseAssistantProgressTabLocal(input) {
    const source = input && typeof input === 'object' ? input : {};
    const currentTab = source.currentTab === 'progress' ? 'progress' : 'manual';
    if (source.hasBatchContext === true && source.userSelectedTab !== true) return 'progress';
    return currentTab;
  }

  function buildAssistantWarningLocal(input) {
    const source = input && typeof input === 'object' ? input : {};
    if (source.firstGenerationFailed === true || source.warning === 'first_generation_failed') {
      return {
        visible: true,
        text: 'AI generation failed and no reusable copy is available. Check the local backend or model service.'
      };
    }
    const reuseCount = Number(source.previousReuseCount || source.reuseCount || 0);
    if (source.warning === 'same_copy_reused_3_times' || reuseCount >= 3) {
      return {
        visible: true,
        text: `The same AI copy has been reused ${Math.max(3, reuseCount)} times. Check the local backend or model service.`
      };
    }
    return { visible: false, text: '' };
  }

  function activateQwenProgressTabForBatch() {
    if (!qwenPanelEl || !qwenPanelEl.parentNode || typeof qwenPanelEl._qwenSetActiveTab !== 'function') return;
    const nextTab = chooseAssistantProgressTabLocal({
      hasBatchContext: !!_batchCtx,
      userSelectedTab: qwenPanelEl._qwenUserSelectedTab === true,
      currentTab: qwenPanelEl._qwenActiveTab || 'manual'
    });
    qwenPanelEl._qwenSetActiveTab(nextTab);
    if (typeof qwenPanelEl._qwenRefreshBatchProgress === 'function') {
      qwenPanelEl._qwenRefreshBatchProgress();
    }
  }

  function createOrToggleQwenPanel() {
    if (qwenPanelEl && qwenPanelEl.parentNode) {
      qwenPanelEl.parentNode.removeChild(qwenPanelEl);
      qwenPanelEl = null;
      if (qwenProgressTimer) {
        clearInterval(qwenProgressTimer);
        qwenProgressTimer = null;
      }
      return;
    }

    const panel = document.createElement('div');
    panel.id = 'auto-register-qwen-panel';
    panel.style.position = 'fixed';
    panel.style.right = '24px';
    panel.style.bottom = '24px';
    panel.style.width = '360px';
    panel.style.maxWidth = '80vw';
    panel.style.maxHeight = '60vh';
    panel.style.zIndex = '2147483647';
    panel.style.background = 'rgba(15,23,42,0.97)';
    panel.style.color = '#e5e7eb';
    panel.style.borderRadius = '12px';
    panel.style.boxShadow = '0 18px 45px rgba(15,23,42,0.55)';
    panel.style.backdropFilter = 'blur(14px)';
    panel.style.fontFamily =
      "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Oxygen,Ubuntu,Cantarell,'Open Sans','Helvetica Neue',sans-serif";
    panel.style.display = 'flex';
    panel.style.flexDirection = 'column';
    panel.style.overflow = 'hidden';

    const header = document.createElement('div');
    header.style.display = 'flex';
    header.style.alignItems = 'center';
    header.style.justifyContent = 'space-between';
    header.style.padding = '10px 14px';
    header.style.borderBottom = '1px solid rgba(148,163,184,0.25)';
    header.style.fontSize = '13px';
    header.style.fontWeight = '600';
    header.textContent = 'AI · 网站推广助手';

    const closeBtn = document.createElement('button');
    closeBtn.textContent = '×';
    closeBtn.style.border = 'none';
    closeBtn.style.background = 'transparent';
    closeBtn.style.color = '#9ca3af';
    closeBtn.style.cursor = 'pointer';
    closeBtn.style.fontSize = '16px';
    closeBtn.style.lineHeight = '1';
    closeBtn.style.padding = '2px 4px';
    closeBtn.addEventListener('mouseenter', () => { closeBtn.style.color = '#e5e7eb'; });
    closeBtn.addEventListener('mouseleave', () => { closeBtn.style.color = '#9ca3af'; });
    closeBtn.addEventListener('click', () => {
      if (panel.parentNode) panel.parentNode.removeChild(panel);
      qwenPanelEl = null;
      if (qwenProgressTimer) {
        clearInterval(qwenProgressTimer);
        qwenProgressTimer = null;
      }
    });

    header.appendChild(closeBtn);

    const tabBar = document.createElement('div');
    tabBar.style.display = 'flex';
    tabBar.style.gap = '6px';
    tabBar.style.padding = '8px 12px 0';
    tabBar.style.borderBottom = '1px solid rgba(148,163,184,0.16)';

    const manualTab = document.createElement('button');
    manualTab.type = 'button';
    manualTab.textContent = '手动助手';
    const progressTab = document.createElement('button');
    progressTab.type = 'button';
    progressTab.textContent = '批量进度';
    [manualTab, progressTab].forEach((tab) => {
      tab.style.border = '1px solid rgba(148,163,184,0.35)';
      tab.style.borderBottom = 'none';
      tab.style.borderRadius = '8px 8px 0 0';
      tab.style.background = 'rgba(15,23,42,0.55)';
      tab.style.color = '#cbd5e1';
      tab.style.cursor = 'pointer';
      tab.style.fontSize = '12px';
      tab.style.padding = '6px 10px';
      tab.style.lineHeight = '1';
    });
    tabBar.appendChild(manualTab);
    tabBar.appendChild(progressTab);

    const body = document.createElement('div');
    body.style.padding = '10px 12px 12px';
    body.style.display = 'flex';
    body.style.flexDirection = 'column';
    body.style.gap = '8px';
    body.style.fontSize = '12px';

    const hint = document.createElement('div');
    hint.textContent = '基于当前网页内容，一键生成推广文案。';
    hint.style.color = '#9ca3af';
    hint.style.lineHeight = '1.4';

    const btnRow = document.createElement('div');
    btnRow.style.display = 'flex';
    btnRow.style.alignItems = 'center';
    btnRow.style.gap = '8px';

    const generateBtn = document.createElement('button');
    generateBtn.textContent = 'AI生成推广文案';
    generateBtn.style.flex = '1';
    generateBtn.style.border = 'none';
    generateBtn.style.borderRadius = '999px';
    generateBtn.style.padding = '7px 12px';
    generateBtn.style.fontSize = '12px';
    generateBtn.style.fontWeight = '500';
    generateBtn.style.cursor = 'pointer';
    generateBtn.style.background = 'linear-gradient(135deg, #2563eb, #4f46e5)';
    generateBtn.style.color = '#f9fafb';
    generateBtn.style.boxShadow = '0 10px 24px rgba(37,99,235,0.45)';
    generateBtn.addEventListener('mouseenter', () => {
      if (!generateBtn.disabled) generateBtn.style.filter = 'brightness(1.05)';
    });
    generateBtn.addEventListener('mouseleave', () => { generateBtn.style.filter = 'none'; });

    const copyBtn = document.createElement('button');
    copyBtn.textContent = '复制文案';
    copyBtn.style.border = 'none';
    copyBtn.style.borderRadius = '999px';
    copyBtn.style.padding = '7px 10px';
    copyBtn.style.fontSize = '12px';
    copyBtn.style.cursor = 'pointer';
    copyBtn.style.background = 'rgba(15,23,42,0.8)';
    copyBtn.style.color = '#e5e7eb';
    copyBtn.style.border = '1px solid rgba(148,163,184,0.6)';
    copyBtn.disabled = true;
    copyBtn.style.opacity = '0.55';

    const statusEl = document.createElement('div');
    statusEl.style.minHeight = '16px';
    statusEl.style.fontSize = '11px';
    statusEl.style.color = '#9ca3af';

    const textarea = document.createElement('textarea');
    textarea.readOnly = true;
    textarea.style.width = '100%';
    textarea.style.flex = '1';
    textarea.style.minHeight = '120px';
    textarea.style.maxHeight = '220px';
    textarea.style.borderRadius = '8px';
    textarea.style.border = '1px solid rgba(148,163,184,0.6)';
    textarea.style.background = 'rgba(15,23,42,0.85)';
    textarea.style.color = '#e5e7eb';
    textarea.style.fontSize = '12px';
    textarea.style.fontFamily = "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace";
    textarea.style.padding = '8px 9px';
    textarea.style.boxSizing = 'border-box';
    textarea.style.resize = 'vertical';

    btnRow.appendChild(generateBtn);
    btnRow.appendChild(copyBtn);

    body.appendChild(hint);
    body.appendChild(btnRow);
    body.appendChild(statusEl);
    body.appendChild(textarea);

    const progressPane = document.createElement('div');
    progressPane.style.padding = '10px 12px 12px';
    progressPane.style.display = 'none';
    progressPane.style.flexDirection = 'column';
    progressPane.style.gap = '8px';
    progressPane.style.fontSize = '12px';

    const progressTitle = document.createElement('div');
    progressTitle.textContent = '批量进度';
    progressTitle.style.fontSize = '12px';
    progressTitle.style.fontWeight = '700';
    progressTitle.style.color = '#e5e7eb';

    const progressGrid = document.createElement('div');
    progressGrid.style.display = 'grid';
    progressGrid.style.gridTemplateColumns = 'repeat(2, minmax(0, 1fr))';
    progressGrid.style.gap = '6px';

    function createProgressMetric(label) {
      const box = document.createElement('div');
      box.style.border = '1px solid rgba(148,163,184,0.24)';
      box.style.borderRadius = '8px';
      box.style.padding = '7px 8px';
      box.style.background = 'rgba(15,23,42,0.62)';
      const labelEl = document.createElement('div');
      labelEl.textContent = label;
      labelEl.style.color = '#94a3b8';
      labelEl.style.fontSize = '10px';
      const valueEl = document.createElement('div');
      valueEl.textContent = '--';
      valueEl.style.color = '#f8fafc';
      valueEl.style.fontSize = '14px';
      valueEl.style.fontWeight = '700';
      valueEl.style.marginTop = '2px';
      box.appendChild(labelEl);
      box.appendChild(valueEl);
      return { box, valueEl };
    }

    const metricCompleted = createProgressMetric('已完成');
    const metricSuccess = createProgressMetric('成功');
    const metricCurrent = createProgressMetric('当前');
    const metricEta = createProgressMetric('预计结束');
    [metricCompleted, metricSuccess, metricCurrent, metricEta].forEach((item) => progressGrid.appendChild(item.box));

    const progressTrack = document.createElement('div');
    progressTrack.style.height = '7px';
    progressTrack.style.borderRadius = '999px';
    progressTrack.style.background = 'rgba(148,163,184,0.22)';
    progressTrack.style.overflow = 'hidden';
    const progressFill = document.createElement('div');
    progressFill.style.height = '100%';
    progressFill.style.width = '0%';
    progressFill.style.borderRadius = '999px';
    progressFill.style.background = 'linear-gradient(90deg, #22c55e, #38bdf8)';
    progressFill.style.transition = 'width 220ms ease';
    progressTrack.appendChild(progressFill);

    const progressStage = document.createElement('div');
    progressStage.textContent = '等待批量任务开始';
    progressStage.style.color = '#94a3b8';
    progressStage.style.fontSize = '11px';
    progressStage.style.lineHeight = '1.35';

    const progressWarning = document.createElement('div');
    progressWarning.style.display = 'none';
    progressWarning.style.color = '#fecaca';
    progressWarning.style.background = 'rgba(127,29,29,0.45)';
    progressWarning.style.border = '1px solid rgba(248,113,113,0.45)';
    progressWarning.style.borderRadius = '6px';
    progressWarning.style.padding = '6px 7px';
    progressWarning.style.fontSize = '11px';
    progressWarning.style.lineHeight = '1.35';

    progressPane.appendChild(progressTitle);
    progressPane.appendChild(progressGrid);
    progressPane.appendChild(progressTrack);
    progressPane.appendChild(progressStage);
    progressPane.appendChild(progressWarning);

    panel.appendChild(header);
    panel.appendChild(tabBar);
    panel.appendChild(body);
    panel.appendChild(progressPane);

    document.documentElement.appendChild(panel);
    qwenPanelEl = panel;

    qwenPanelEl._qwenTextarea = textarea;
    qwenPanelEl._qwenSetStatus = setStatus;
    qwenPanelEl._qwenSetCopyEnabled = setCopyEnabled;
    qwenPanelEl._qwenSetGenerateLoading = setGenerateLoading;
    qwenPanelEl._qwenActiveTab = 'manual';
    qwenPanelEl._qwenUserSelectedTab = false;
    qwenPanelEl._qwenPresetCopyMode = false;

    function setTabActive(tabName) {
      const isProgress = tabName === 'progress';
      qwenPanelEl._qwenActiveTab = isProgress ? 'progress' : 'manual';
      body.style.display = isProgress ? 'none' : 'flex';
      progressPane.style.display = isProgress ? 'flex' : 'none';
      manualTab.style.background = isProgress ? 'rgba(15,23,42,0.55)' : 'rgba(37,99,235,0.9)';
      progressTab.style.background = isProgress ? 'rgba(37,99,235,0.9)' : 'rgba(15,23,42,0.55)';
      manualTab.style.color = isProgress ? '#cbd5e1' : '#f8fafc';
      progressTab.style.color = isProgress ? '#f8fafc' : '#cbd5e1';
    }
    qwenPanelEl._qwenSetActiveTab = setTabActive;
    qwenPanelEl._qwenRefreshBatchProgress = refreshBatchProgressPane;

    async function refreshBatchProgressPane() {
      if (!qwenPanelEl || !qwenPanelEl.parentNode || typeof chrome === 'undefined' || !chrome.storage || !chrome.storage.local) return;
      const data = await new Promise((resolve) => chrome.storage.local.get([BATCH_RUNTIME_STATE_KEY, AI_REUSE_STATE_STORAGE_KEY], resolve));
      const progress = buildCompactBatchProgressLocal(data[BATCH_RUNTIME_STATE_KEY]);
      const warning = buildAssistantWarningLocal(data[AI_REUSE_STATE_STORAGE_KEY]);
      if (!progress.isBatch) {
        metricCompleted.valueEl.textContent = '--';
        metricSuccess.valueEl.textContent = '--';
        metricCurrent.valueEl.textContent = '--';
        metricEta.valueEl.textContent = '未运行';
        progressFill.style.width = '0%';
        progressStage.textContent = '当前没有批量任务';
        progressWarning.style.display = 'none';
        progressWarning.textContent = '';
        return;
      }
      metricCompleted.valueEl.textContent = `${progress.completed} / ${progress.total}`;
      metricSuccess.valueEl.textContent = String(progress.success);
      metricCurrent.valueEl.textContent = progress.total > 0 ? `第 ${progress.current} 条` : '--';
      metricEta.valueEl.textContent = progress.etaText;
      progressFill.style.width = `${progress.percent}%`;
      progressStage.textContent = progress.stageText;
      progressWarning.style.display = warning.visible ? 'block' : 'none';
      progressWarning.textContent = warning.text || '';
    }

    manualTab.addEventListener('click', () => {
      qwenPanelEl._qwenUserSelectedTab = true;
      setTabActive('manual');
    });
    progressTab.addEventListener('click', () => {
      qwenPanelEl._qwenUserSelectedTab = true;
      setTabActive('progress');
      refreshBatchProgressPane();
    });
    setTabActive(chooseAssistantProgressTabLocal({
      hasBatchContext: !!_batchCtx,
      userSelectedTab: false,
      currentTab: 'manual'
    }));
    refreshBatchProgressPane();
    qwenProgressTimer = setInterval(refreshBatchProgressPane, 1500);

    if (lastGeneratedPromotionCopy) {
      textarea.value = lastGeneratedPromotionCopy;
      setCopyEnabled(true);
      setStatus('已自动生成推广文案，可以复制使用。', '#22c55e');
    }

    function setStatus(text, color) {
      statusEl.textContent = text || '';
      if (color) statusEl.style.color = color;
    }

    function setCopyEnabled(enabled) {
      copyBtn.disabled = !enabled;
      copyBtn.style.opacity = enabled ? '1' : '0.55';
    }

    function setGenerateLoading(loading) {
      if (loading) {
        generateBtn.disabled = true;
        generateBtn.style.opacity = '0.55';
        generateBtn.style.cursor = 'not-allowed';
        generateBtn.style.background = '#4b5563';
        generateBtn.style.boxShadow = 'none';
        generateBtn.textContent = '生成中…';
      } else {
        generateBtn.disabled = false;
        generateBtn.style.opacity = '1';
        generateBtn.style.cursor = 'pointer';
        generateBtn.style.background = 'linear-gradient(135deg, #2563eb, #4f46e5)';
        generateBtn.style.boxShadow = '0 10px 24px rgba(37,99,235,0.45)';
        generateBtn.textContent = 'AI生成推广文案';
      }
    }

    generateBtn.addEventListener('click', async () => {
      qwenPanelEl._qwenPresetCopyMode = false;
      setStatus('正在生成推广文案，请稍候…', '#9ca3af');
      textarea.value = '';
      setCopyEnabled(false);
      setGenerateLoading(true);
      try {
        const text = await generatePromotionCopyWithRetry(3);
        if (!text) {
          lastGeneratedPromotionCopy = '';
          textarea.value = '';
          setStatus('当前页面命中黑名单，已跳过生成并退回积分。', '#f59e0b');
          setCopyEnabled(false);
          setGenerateLoading(false);
          return;
        }
        lastGeneratedPromotionCopy = text;
        textarea.value = text;
        await recordGenerationTime(text);

        // ── 把文案填入页面评论框 ────────────────────────────────────
        console.log('[AutoComment] >>>[0] 即将调用 tryFillCommentTextareaWithPromotion');
        const filled = tryFillCommentTextareaWithPromotion(text);
        console.log('[AutoComment] >>>[1] tryFillCommentTextareaWithPromotion 返回:', filled);
        if (!filled) {
          console.log('[AutoComment] 页面评论框填充未成功（可能已有内容或未找到文本框）');
        }

        // ── 步骤A：读取用户配置 ─────────────────────────────────
        console.log('[AutoComment] >>>[2] 即将调用 getUserProfile...');
        const userProfile = await getUserProfile();
        console.log('[AutoComment] >>>[3] getUserProfile() 完成:', JSON.stringify(userProfile));

        console.log('[AutoComment] >>>[4] 检查用户配置是否完整...');
        if (!userProfile.name || !userProfile.email) {
          const missing = [];
          if (!userProfile.name) missing.push('姓名（Name）');
          if (!userProfile.email) missing.push('邮箱（Email）');
          const msg = '请先在扩展选项页填写' + missing.join('和') + '，否则无法自动提交评论！';
          setStatus(msg, '#f97373');
          console.error('[AutoComment] ' + msg);
          setCopyEnabled(true);
          setGenerateLoading(false);
          return;
        }
        console.log('[AutoComment] >>>[5] 用户配置检查通过，继续执行...');

        setCopyEnabled(true);

        // === 自动提交评论（全自动，无需手动点击任何按钮）===
        console.log('[AutoComment] >>>[6] 即将调用 getAutoSubmitCommentSetting...');
        const shouldAutoSubmit = await getAutoSubmitCommentSetting();
        console.log('[AutoComment] shouldAutoSubmit =', shouldAutoSubmit);

        console.log('[AutoComment] >>>[7] shouldAutoSubmit 检查完成，开始判断...');
        if (shouldAutoSubmit) {
          console.log('[AutoComment] >>>[8] shouldAutoSubmit 为 true，准备自动提交...');
          setStatus('正在自动提交评论，请稍候…', '#9ca3af');

          // 确保所有表单字段都已填好，再点击提交按钮
          const fillResult = await ensureAllCommentFormFieldsFilled(text);

          if (!fillResult.success) {
            const msg = '以下字段缺失，无法自动提交：' + fillResult.missingFields.join('、');
            setStatus(msg + '，请手动检查', '#f97373');
            console.error('[AutoComment] 自动提交跳过 - 字段缺失:', fillResult.missingFields);
            setGenerateLoading(false);
            return;
          }

          const submitButton = findCommentSubmitButton();
          if (!submitButton) {
            setStatus('未找到提交按钮，请手动提交', '#f59e0b');
            setGenerateLoading(false);
            return;
          }

          if (!isButtonClickable(submitButton)) {
            setStatus('提交按钮不可见，请手动检查', '#f59e0b');
            setGenerateLoading(false);
            return;
          }

          // 等待一小段时间确保页面 JS 验证逻辑已完成初始化
          await new Promise(resolve => setTimeout(resolve, 600));

          const result = await clickCommentSubmitButton();
          try {
            await ensureSubmitConfirmed(result);
          } catch (submitError) {
            result.success = false;
            result.error = submitError.message || String(submitError);
          }
          if (result.success) {
            setStatus('评论已自动提交！', '#22c55e');
            // 批处理模式：提交成功后上报结果到 batch.html
            if (_batchCtx) {
              await reportSuccessToBatch(text);
            }
          } else {
            setStatus('自动提交失败：' + (result.error || '未知错误') + '，请手动提交', '#f97373');
          }
        console.log('[AutoComment] >>>[7b] shouldAutoSubmit 为 false，仅填充文案');
        } else {
          // 未开启自动提交，仅填充文案并高亮提交按钮
          console.log('[AutoComment] >>>[9] 未开启自动提交，仅填充文案并高亮按钮...');
          setStatus('生成完成！文案已填入评论框，勾选"自动提交"即可全自动发送', '#22c55e');

          const submitButton = findCommentSubmitButton();
          if (submitButton) {
            console.log('[AutoComment] >>>[10] 找到提交按钮，高亮显示...');
            submitButton.scrollIntoView({ behavior: 'smooth', block: 'center' });
            submitButton.style.outline = '3px solid #22c55e';
            submitButton.style.outlineOffset = '2px';
            setTimeout(() => {
              submitButton.style.outline = '';
              submitButton.style.outlineOffset = '';
            }, 3000);
          } else {
            console.log('[AutoComment] >>>[11] 未找到提交按钮');
          }
        }
        setGenerateLoading(false);
      } catch (err) {
        const msg = (err && err.message) || '生成失败，请检查控制台日志。';
        setStatus(msg, '#f97373');
        setCopyEnabled(false);
        setGenerateLoading(false);
      }
    });

    copyBtn.addEventListener('click', async () => {
      const isPresetCopy = qwenPanelEl && qwenPanelEl._qwenPresetCopyMode === true;
      const text = isPresetCopy ? textarea.value : textarea.value.trim();
      if (!text && !isPresetCopy) return;

      try {
        if (navigator.clipboard && navigator.clipboard.writeText) {
          await navigator.clipboard.writeText(text);
        } else {
          const temp = document.createElement('textarea');
          temp.value = text;
          temp.style.position = 'fixed';
          temp.style.left = '-9999px';
          document.body.appendChild(temp);
          temp.select();
          document.execCommand('copy');
          document.body.removeChild(temp);
        }
        setStatus(text ? '文案已复制到剪贴板。' : '文案为空', text ? '#22c55e' : '#f59e0b');
      } catch (err) {
        setStatus('复制失败，请手动选择文本复制。', '#f97373');
      }
    });

    // ====== 外链分析功能 ======
    function analyzeOutlinks() {
      const links = Array.from(document.querySelectorAll('a[href]'));

      const outlinks = links
        .map(link => {
          const href = link.href;
          try {
            const url = new URL(href);
            if (url.protocol === 'mailto:' ||
                url.protocol === 'tel:' ||
                url.protocol === 'javascript:' ||
                href.startsWith('#')) {
              return null;
            }
            // 过滤协议和同站链接
            const currentHost = window.location.hostname;
            const currentDomain = currentHost.replace(/^www\./, '');
            const linkDomain = url.hostname.replace(/^www\./, '');
            if (linkDomain === currentDomain) {
              return null;
            }
            const rel = (link.rel || '').toLowerCase();
            const isNofollow = rel.includes('nofollow');

            return {
              url: href,
              text: link.textContent?.trim() || link.innerText?.trim() || '',
              host: url.hostname,
              isNofollow,
              isDofollow: !isNofollow
            };
          } catch (e) {
            return null;
          }
        })
        .filter(Boolean);

      const seen = new Set();
      return outlinks.filter(link => {
        if (seen.has(link.url)) return false;
        seen.add(link.url);
        return true;
      });
    }

    function showOutlinksPanel() {
      const existing = document.getElementById('auto-comment-outlinks-panel');
      if (existing) existing.remove();

      const outlinks = analyzeOutlinks();
      const dofollowCount = outlinks.filter(l => l.isDofollow).length;
      const nofollowCount = outlinks.filter(l => l.isNofollow).length;

      const panel = document.createElement('div');
      panel.id = 'auto-comment-outlinks-panel';
      panel.style.position = 'fixed';
      panel.style.left = '50%';
      panel.style.top = '50%';
      panel.style.transform = 'translate(-50%, -50%)';
      panel.style.width = '600px';
      panel.style.maxWidth = '90vw';
      panel.style.maxHeight = '80vh';
      panel.style.zIndex = '2147483647';
      panel.style.background = 'rgba(15,23,42,0.98)';
      panel.style.color = '#e5e7eb';
      panel.style.borderRadius = '12px';
      panel.style.boxShadow = '0 18px 45px rgba(15,23,42,0.55)';
      panel.style.fontFamily = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif";
      panel.style.display = 'flex';
      panel.style.flexDirection = 'column';
      panel.style.overflow = 'hidden';

      const header = document.createElement('div');
      header.style.display = 'flex';
      header.style.alignItems = 'center';
      header.style.justifyContent = 'space-between';
      header.style.padding = '12px 16px';
      header.style.borderBottom = '1px solid rgba(148,163,184,0.25)';

      const title = document.createElement('div');
      title.style.fontSize = '14px';
      title.style.fontWeight = '600';
      title.textContent = `外链分析 - 共 ${outlinks.length} 个`;

      const closeBtn = document.createElement('button');
      closeBtn.textContent = '×';
      closeBtn.style.border = 'none';
      closeBtn.style.background = 'transparent';
      closeBtn.style.color = '#9ca3af';
      closeBtn.style.cursor = 'pointer';
      closeBtn.style.fontSize = '18px';
      closeBtn.addEventListener('click', () => panel.remove());

      header.appendChild(title);
      header.appendChild(closeBtn);

      const stats = document.createElement('div');
      stats.style.display = 'flex';
      stats.style.gap = '16px';
      stats.style.padding = '10px 16px';
      stats.style.fontSize = '12px';
      stats.style.borderBottom = '1px solid rgba(148,163,184,0.15)';

      const dofollowStat = document.createElement('span');
      dofollowStat.innerHTML = `<span style="color:#22c55e;font-weight:600">✓ DoFollow:</span> ${dofollowCount}`;
      const nofollowStat = document.createElement('span');
      nofollowStat.innerHTML = `<span style="color:#f97373;font-weight:600">✗ NoFollow:</span> ${nofollowCount}`;

      stats.appendChild(dofollowStat);
      stats.appendChild(nofollowStat);

      const list = document.createElement('div');
      list.style.flex = '1';
      list.style.overflowY = 'auto';
      list.style.padding = '8px';

      if (outlinks.length === 0) {
        list.innerHTML = '<div style="text-align:center;color:#9ca3af;padding:20px">未检测到外链</div>';
      } else {
        outlinks.forEach(link => {
          const item = document.createElement('div');
          item.style.display = 'flex';
          item.style.alignItems = 'center';
          item.style.gap = '8px';
          item.style.padding = '6px 8px';
          item.style.borderRadius = '6px';
          item.style.fontSize = '11px';
          item.style.wordBreak = 'break-all';

          const tag = document.createElement('span');
          tag.style.flexShrink = '0';
          tag.style.padding = '2px 6px';
          tag.style.borderRadius = '4px';
          tag.style.fontSize = '10px';
          tag.style.fontWeight = '600';

          if (link.isDofollow) {
            tag.style.background = 'rgba(34,197,94,0.2)';
            tag.style.color = '#22c55e';
            tag.textContent = 'DoFollow';
          } else {
            tag.style.background = 'rgba(249,115,115,0.2)';
            tag.style.color = '#f97373';
            tag.textContent = 'NoFollow';
          }

          const linkEl = document.createElement('a');
          linkEl.href = link.url;
          linkEl.textContent = link.host;
          linkEl.style.color = '#60a5fa';
          linkEl.style.textDecoration = 'none';
          linkEl.style.fontFamily = 'monospace';
          linkEl.target = '_blank';

          item.appendChild(tag);
          item.appendChild(linkEl);
          list.appendChild(item);
        });
      }

      const exportBtn = document.createElement('button');
      exportBtn.textContent = '导出 CSV';
      exportBtn.style.margin = '12px 16px';
      exportBtn.style.padding = '8px 16px';
      exportBtn.style.border = 'none';
      exportBtn.style.borderRadius = '6px';
      exportBtn.style.background = 'linear-gradient(135deg, #2563eb, #4f46e5)';
      exportBtn.style.color = '#fff';
      exportBtn.style.fontSize = '12px';
      exportBtn.style.cursor = 'pointer';
      exportBtn.addEventListener('click', () => {
        const csvHost = window.location.hostname;
        const csvContent = [
          ['URL', 'Hostname', 'Type', 'Link Text'].join(','),
          ...outlinks.map(l => [
            `"${l.url.replace(/"/g, '""')}"`,
            `"${l.host}"`,
            l.isDofollow ? 'DoFollow' : 'NoFollow',
            `"${l.text.replace(/"/g, '""')}"`
          ].join(','))
        ].join('\n');

        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `outlinks-${csvHost}.csv`;
        a.click();
        URL.revokeObjectURL(url);
      });

      panel.appendChild(header);
      panel.appendChild(stats);
      panel.appendChild(list);
      panel.appendChild(exportBtn);
      document.body.appendChild(panel);
    }

    const outlinkBtn = document.createElement('button');
    outlinkBtn.textContent = '分析外链';
    outlinkBtn.style.border = 'none';
    outlinkBtn.style.borderRadius = '999px';
    outlinkBtn.style.padding = '7px 10px';
    outlinkBtn.style.fontSize = '12px';
    outlinkBtn.style.cursor = 'pointer';
    outlinkBtn.style.background = 'rgba(15,23,42,0.8)';
    outlinkBtn.style.color = '#e5e7eb';
    outlinkBtn.style.border = '1px solid rgba(148,163,184,0.6)';
    outlinkBtn.addEventListener('click', showOutlinksPanel);

    btnRow.appendChild(generateBtn);
    btnRow.appendChild(outlinkBtn);
    btnRow.appendChild(copyBtn);
  }

  // ====== 独立外链导出浮窗按钮 ======
  // 不依赖 AI 面板自动打开设置；批量任务打开博客页时也必须能直接点击并下载 CSV。
  function analyzePageOutlinksForExport() {
    const links = Array.from(document.querySelectorAll('a[href]'));
    const currentHost = window.location.hostname;
    const currentDomain = currentHost.replace(/^www\./, '');

    const outlinks = links
      .map(link => {
        const href = link.href;
        try {
          const url = new URL(href);
          if (url.protocol !== 'http:' && url.protocol !== 'https:') {
            return null;
          }

          const linkDomain = url.hostname.replace(/^www\./, '');
          if (linkDomain === currentDomain) {
            return null;
          }

          const rel = (link.rel || '').toLowerCase();
          const isNofollow = rel.includes('nofollow');
          return {
            url: href,
            text: link.textContent?.trim() || link.innerText?.trim() || '',
            host: url.hostname,
            isNofollow,
            isDofollow: !isNofollow
          };
        } catch (e) {
          return null;
        }
      })
      .filter(Boolean);

    const seen = new Set();
    return outlinks.filter(link => {
      if (seen.has(link.url)) return false;
      seen.add(link.url);
      return true;
    });
  }

  function exportPageOutlinksCsv() {
    const outlinks = analyzePageOutlinksForExport();
    const csvHost = window.location.hostname || 'unknown-host';
    const csvContent = [
      ['URL', 'Hostname', 'Type', 'Link Text'].join(','),
      ...outlinks.map(l => [
        `"${String(l.url || '').replace(/"/g, '""')}"`,
        `"${String(l.host || '').replace(/"/g, '""')}"`,
        l.isDofollow ? 'DoFollow' : 'NoFollow',
        `"${String(l.text || '').replace(/"/g, '""')}"`
      ].join(','))
    ].join('\n');

    const blob = new Blob(['\uFEFF' + csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `outlinks-${csvHost}.csv`;
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    console.log('[AutoComment] 已导出外链 CSV:', { host: csvHost, count: outlinks.length });
  }

  function showQwenPanel(options = {}) {
    if (!qwenPanelEl || !qwenPanelEl.parentNode) {
      createOrToggleQwenPanel();
    }
    if (!qwenPanelEl || !qwenPanelEl.parentNode) return false;
    qwenPanelEl.style.display = 'flex';
    qwenPanelEl.style.zIndex = '2147483647';
    if (options.tab === 'manual' && typeof qwenPanelEl._qwenSetActiveTab === 'function') {
      qwenPanelEl._qwenUserSelectedTab = true;
      qwenPanelEl._qwenSetActiveTab('manual');
    }
    if (Object.prototype.hasOwnProperty.call(options, 'presetAiContent') && qwenPanelEl._qwenTextarea) {
      const presetText = String(options.presetAiContent || '');
      lastGeneratedPromotionCopy = presetText;
      lastGeneratedPromotionCopyKey = '';
      qwenPanelEl._qwenPresetCopyMode = true;
      qwenPanelEl._qwenTextarea.value = presetText;
      if (typeof qwenPanelEl._qwenSetCopyEnabled === 'function') {
        qwenPanelEl._qwenSetCopyEnabled(true);
      }
      if (typeof qwenPanelEl._qwenSetStatus === 'function') {
        qwenPanelEl._qwenSetStatus(
          presetText ? '已加载结果页已有文案，可直接复制。' : '文案为空',
          presetText ? '#22c55e' : '#f59e0b'
        );
      }
    }
    if (qwenPanelEl._qwenTextarea && typeof qwenPanelEl._qwenTextarea.focus === 'function') {
      qwenPanelEl._qwenTextarea.focus();
    }
    return true;
  }

  function ensureOutlinkFloatingButton() {
    if (document.getElementById('auto-comment-export-outlinks-btn')) {
      return;
    }

    const btn = document.createElement('button');
    btn.id = 'auto-comment-export-outlinks-btn';
    btn.type = 'button';
    btn.textContent = '导出外链';
    btn.setAttribute('data-action', 'analyze-backlinks');
    btn.setAttribute('data-testid', 'analyze-backlinks');
    btn.title = '导出当前页面外链 CSV';
    btn.style.position = 'fixed';
    btn.style.left = '18px';
    btn.style.bottom = '86px';
    btn.style.zIndex = '2147483647';
    btn.style.display = 'inline-flex';
    btn.style.alignItems = 'center';
    btn.style.justifyContent = 'center';
    btn.style.minWidth = '88px';
    btn.style.height = '36px';
    btn.style.padding = '0 14px';
    btn.style.border = '1px solid rgba(148,163,184,0.72)';
    btn.style.borderRadius = '999px';
    btn.style.background = 'rgba(15,23,42,0.94)';
    btn.style.color = '#f8fafc';
    btn.style.boxShadow = '0 10px 26px rgba(15,23,42,0.35)';
    btn.style.fontFamily = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif";
    btn.style.fontSize = '13px';
    btn.style.fontWeight = '600';
    btn.style.lineHeight = '1';
    btn.style.cursor = 'pointer';
    btn.style.whiteSpace = 'nowrap';
    btn.addEventListener('mouseenter', () => {
      btn.style.background = 'rgba(30,41,59,0.98)';
    });
    btn.addEventListener('mouseleave', () => {
      btn.style.background = 'rgba(15,23,42,0.94)';
    });
    btn.addEventListener('click', exportPageOutlinksCsv);

    (document.body || document.documentElement).appendChild(btn);
    console.log('[AutoComment] 独立导出外链浮窗按钮已注入');
  }

  // 监听 background.js 中点击扩展图标发送的消息
  if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.onMessage) {
    chrome.runtime.onMessage.addListener((message, _sender, _sendResponse) => {
      // 就绪检测：batch.js 发 PING 确认 content.js 已注入
      if (message && message.type === 'PING') {
        _sendResponse({ ok: true });
        return;
      }
      if (message && message.type === 'TOGGLE_PROMOTE_PANEL') {
        createOrToggleQwenPanel();
      }
      if (message && message.type === 'SHOW_PROMOTE_PANEL') {
        const options = { tab: message.tab === 'progress' ? 'progress' : 'manual' };
        if (Object.prototype.hasOwnProperty.call(message, 'presetAiContent')) {
          options.presetAiContent = message.presetAiContent;
        }
        const shown = showQwenPanel(options);
        _sendResponse({ ok: shown });
        return;
      }
      if (message && message.type === 'BATCH_HANDLE') {
        console.log('[content] BATCH_HANDLE received', { batchId: message.batchId, urlIndex: message.urlIndex, url: message.url, time: new Date().toISOString() });
        const taskKey = getBatchTaskKey(message.batchId, message.urlIndex);
        if (runningBatchTaskKey === taskKey) {
          console.log('[content] duplicate BATCH_HANDLE ignored because task is already running:', taskKey);
          _sendResponse({ ok: true, accepted: true, duplicate: true, urlIndex: message.urlIndex });
          return;
        }
        setBatchContext(message.batchId, message.urlIndex, message.url, message);
        _sendResponse({ ok: true, accepted: true, urlIndex: message.urlIndex });
        handleBatchTask(message.batchId, message.urlIndex, message.url)
          .then(() => {
            console.log('[content] BATCH_HANDLE async task completed');
          })
          .catch((err) => {
            console.error('[content] BATCH_HANDLE async task failed:', err);
          });
        return;
      }
    });
  }

  // ==================== 批量处理任务函数 ====================
  /**
   * 批量模式：自动完成评论流程并上报结果
   */
  function getMetaContent(selector) {
    const el = document.querySelector(selector);
    return el ? (el.getAttribute('content') || '') : '';
  }

  function evaluateCurrentPageForIllegalSite(url) {
    const filter = window.AutoCommentIllegalSiteFilter;
    if (!filter || typeof filter.evaluatePage !== 'function') {
      console.warn('[content] 非法网站过滤器未加载，跳过页面检测');
      return { blocked: false };
    }

    const pageText = document.body ? document.body.innerText : '';
    return filter.evaluatePage(url || location.href, {
      title: document.title || '',
      description: getMetaContent('meta[name="description"], meta[property="og:description"]'),
      keywords: getMetaContent('meta[name="keywords"]'),
      text: pageText
    });
  }

  async function reportIllegalSiteAndClose(batchId, urlIndex, url, check) {
    const reason = (check && check.reason) || '非法网站拦截：命中赌博/色情规则';
    console.warn('[content] 检测到非法网站，上报 blocked_illegal 并关闭网页:', { batchId, urlIndex, url, reason });
    await writePendingResult(batchId, urlIndex, url, 'blocked_illegal', null, reason);

    await new Promise((resolve) => {
      chrome.runtime.sendMessage({
        type: 'BATCH_HANDLE_CONFIRM',
        batchId,
        urlIndex,
        url: url || location.href || '',
        aiContent: '',
        result: 'blocked_illegal',
        errorMessage: reason
      }).then((response) => {
        console.log('[content] blocked_illegal BATCH_HANDLE_CONFIRM 响应:', response);
        resolve(response);
      }).catch((err) => {
        if (err.message && err.message.includes('message channel closed')) {
          console.log('[content] 消息通道已关闭（标签页可能已关闭），忽略错误');
        } else {
          console.warn('[content] blocked_illegal 发送消息失败:', err);
        }
        resolve(null);
      });
    });

    setTimeout(() => {
      window.close();
    }, 700);
  }

  async function handleBatchTask(batchId, urlIndex, url, originalIndex) {
    console.log('[content] handleBatchTask 开始 >>>', { batchId, urlIndex, url, time: new Date().toISOString() });
    logBatchSubmit('task.start', { batchId, urlIndex, url });
    let aiGenerated = false; // 标记AI是否已生成（用于失败时补偿）
    const taskKey = getBatchTaskKey(batchId, urlIndex);
    if (runningBatchTaskKey === taskKey) {
      console.warn('[content] handleBatchTask 跳过重复执行:', taskKey);
      return;
    }
    runningBatchTaskKey = taskKey;
    try {
      console.log('[content] 1/6 等待页面加载...');
      await waitForPageReady();
      logBatchSubmit('page.ready', { title: document.title || '', href: location.href });
      const domainDrift = classifyDomainDriftLocal({ originalUrl: url, currentUrl: location.href });
      if (domainDrift.drifted) {
        logBatchSubmit('page.domain_drift', {
          originalHost: domainDrift.originalHost,
          currentHost: domainDrift.currentHost,
          currentUrl: location.href,
          result: domainDrift.result,
          errorMessage: domainDrift.errorMessage
        });
        await reportTerminalBatchResultAndClose(
          batchId,
          urlIndex,
          url,
          domainDrift.result,
          null,
          domainDrift.errorMessage
        );
        return;
      }
      const illegalCheck = evaluateCurrentPageForIllegalSite(url);
      if (illegalCheck.blocked) {
        await reportIllegalSiteAndClose(batchId, urlIndex, url, illegalCheck);
        return;
      }
      console.log('[content] 2/6 检查是否已处理过...');
      const promotionWebsiteForSourceCheck = await getWebsiteUrl();
      const sourceHit = detectPromotionSourceHitLocal(
        document.documentElement ? document.documentElement.outerHTML : '',
        promotionWebsiteForSourceCheck
      );
      logBatchSubmit('page.source_hit_check', {
        hit: !!sourceHit.hit,
        reason: sourceHit.reason || '',
        promotionHost: sourceHit.promotionHost || '',
        matchedHref: sourceHit.matchedHref || '',
        sourceMatched: !!sourceHit.sourceMatched
      });
      if (sourceHit.hit) {
        await reportTerminalBatchResultAndClose(
          batchId,
          urlIndex,
          url,
          'source_hit',
          null,
          'source_contains_promotion_link'
        );
        return;
      }
      const existingResult = await checkExistingBatchResult(batchId, url, urlIndex);
      if (existingResult) {
        console.log('[content] 该URL已处理过，跳过AI生成，直接上报:', existingResult);
        await reportAlreadyCommented(batchId, urlIndex, url, existingResult.aiContent);
        return;
      }
      console.log('[content] 3/6 确认评论表单存在...');
      // 先尝试触发评论表单展开（如果表单是隐藏的需要点击回复链接）
      let form = findCommentForm();
      let ta = findLikelyCommentTextarea({ allowGenericFallback: false });
      logBatchSubmit('form.initial_scan', {
        hasForm: !!form,
        hasTextarea: !!ta,
        textareaId: ta && ta.id ? ta.id : '',
        textareaName: ta && ta.name ? ta.name : ''
      });
      const embeddedCommentSignal = detectEmbeddedCommentSignalLocal();
      const initialFormDecision = classifyInitialCommentFormScanLocal({
        hasForm: !!form,
        hasTextarea: !!ta,
        usableCommentFieldCount: ta ? 1 : 0,
        hasEmbeddedCommentSignal: !!embeddedCommentSignal.found,
        embeddedSignalReason: embeddedCommentSignal.reason || '',
        embeddedSignalSrc: embeddedCommentSignal.src || ''
      });
      logBatchSubmit('form.initial_classification', {
        shouldStop: initialFormDecision.shouldStop,
        result: initialFormDecision.result,
        errorMessage: initialFormDecision.errorMessage,
        embeddedSignalFound: !!embeddedCommentSignal.found,
        embeddedSignalReason: embeddedCommentSignal.reason || '',
        embeddedSignalTag: embeddedCommentSignal.tag || '',
        embeddedSignalId: embeddedCommentSignal.id || '',
        embeddedSignalClass: embeddedCommentSignal.className || '',
        embeddedSignalSrc: embeddedCommentSignal.src || '',
        embeddedSignalText: embeddedCommentSignal.text || ''
      });
      if (initialFormDecision.shouldStop) {
        const reportMode = chooseInitialStopReportModeLocal(initialFormDecision);
        logBatchSubmit('form.initial_stop_report', {
          result: initialFormDecision.result,
          errorMessage: initialFormDecision.errorMessage,
          reportMode
        });
        if (reportMode === 'confirm_and_close') {
          await reportTerminalBatchResultAndClose(
            batchId,
            urlIndex,
            url,
            initialFormDecision.result,
            null,
            initialFormDecision.errorMessage
          );
        } else {
          await writePendingResult(batchId, urlIndex, url, initialFormDecision.result, null, initialFormDecision.errorMessage);
          await reportBatchResult(batchId, urlIndex, initialFormDecision.result, null, initialFormDecision.errorMessage, url);
        }
        return;
      }
      if (!form || !ta) {
        console.log('[content] 评论表单未展开，尝试触发展开...');
        await triggerCommentFormFlowForBatch(8000);
        // 等待表单展开后再检查
        await new Promise(resolve => setTimeout(resolve, 1500));
        form = findCommentForm();
        ta = findLikelyCommentTextarea({ allowGenericFallback: false });
      }
      // 如果仍然找不到评论框，检测是否有 Disqus，需要额外等待 iframe 加载
      if (!form || !ta) {
        const hasDisqus = document.querySelector('#disqus_thread, [id*="disqus"], iframe[src*="disqus"]');
        if (hasDisqus) {
          console.log('[content] 检测到 Disqus，额外等待 iframe 加载...');
          // 尝试点击展开按钮
          const disqusBtn = document.querySelector('#disqus_thread a, [id*="disqus"] a, .dsq-brlink a, #disqus_thread button');
          if (disqusBtn && !disqusBtn.hasAttribute('data-auto-comment-clicked')) {
            disqusBtn.setAttribute('data-auto-comment-clicked', 'true');
            disqusBtn.click();
          }
          // 等待 Disqus iframe 完全加载（最常需要的时间）
          await new Promise(resolve => setTimeout(resolve, 5000));
          form = findCommentForm();
          ta = findLikelyCommentTextarea({ allowGenericFallback: true });
          if (ta) {
            console.log('[content] Disqus iframe 加载后找到评论框');
          }
        }
      }
      // 最终检查：仍然找不到评论框则先触发流程再继续（与浮窗按钮行为一致）
      if (!form || !ta) {
        console.log('[content] 未找到评论框，尝试触发展开流程...');
        await triggerCommentFormFlowForBatch(8000);
        await new Promise(resolve => setTimeout(resolve, 2000));
        form = findCommentForm();
        ta = findLikelyCommentTextarea({ allowGenericFallback: true });
      }
      if (!form || !ta) {
        console.log('[content] 常规批处理找框未完成，切换到手动按钮同款找框逻辑...');
        const manualTargets = await findCommentTargetsForBatchUsingManualFlow(12000);
        form = manualTargets.form;
        ta = manualTargets.textarea;
      }
      logBatchSubmit('form.final_scan', {
        hasForm: !!form,
        hasTextarea: !!ta,
        textareaId: ta && ta.id ? ta.id : '',
        textareaName: ta && ta.name ? ta.name : ''
      });
      // 关键：确认找到评论框后再生成 AI 文案，避免浪费积分
      if (!form || !ta) {
        console.log('[content] 未找到评论框，跳过AI生成，结束任务');
        throw new Error('__NO_COMMENT_BOX__');
      }
      const manualCheckBeforeAi = detectManualRequiredChallenge(form);
      if (manualCheckBeforeAi.found) {
        await reportManualRequiredAndClose(batchId, urlIndex, url, null);
        return;
      }
      let aiContent = await getReusablePromotionCopy();
      if (!isUsableGeneratedCopy(aiContent)) {
        aiContent = '';
      }
      if (aiContent) {
        console.log('[content] 4/6 复用已有推广文案，跳过AI生成，长度:', aiContent.length);
        logBatchSubmit('ai.reuse_copy', {
          aiContentLength: aiContent.length,
          aiContent
        });
      } else {
        console.log('[content] 4/6 生成AI文案...');
        aiGenerated = true; // AI即将生成，标记用于失败时补偿
        logBatchSubmit('ai.generate_start');
        aiContent = await generatePromotionCopyWithRetry(1);
        if (!aiContent) {
          aiGenerated = false;
          console.log('[content] AI文案命中黑名单，已由后端退回积分，跳过当前URL');
          await writePendingResult(batchId, urlIndex, url, 'skipped', null, 'blocked_keyword');
          await reportBatchResult(batchId, urlIndex, 'skipped', null, 'blocked_keyword', url);
          return;
        }
      }
      console.log('[content] AI文案生成完成，长度:', aiContent ? aiContent.length : 0, aiContent ? aiContent.substring(0, 80) + '...' : 'null');
      logBatchSubmit('ai.generate_done', {
        aiContentLength: aiContent ? aiContent.length : 0,
        aiContent: aiContent || ''
      });
      console.log('[content] 5/6 填充表单字段...');
      logBatchSubmit('fill.comment_start', {
        aiContentLength: aiContent ? aiContent.length : 0,
        textareaId: ta && ta.id ? ta.id : '',
        textareaName: ta && ta.name ? ta.name : ''
      });
      const promotionUrlForFill = await getWebsiteUrl();
      const batchCommentFillOptions = {
        fast: false,
        typingStrategy: 'human-fast',
        contextChars: 5,
        maxDurationMs: 45000,
        promotionUrl: promotionUrlForFill
      };
      const batchCommentFillPlan = buildSegmentedHumanTypingPlanLocal(aiContent, batchCommentFillOptions);
      const documentHiddenForFill = typeof document !== 'undefined' && document.visibilityState === 'hidden';
      const documentHasFocusForFill = typeof document === 'undefined' || typeof document.hasFocus !== 'function' ? true : document.hasFocus();
      const effectiveDelayScaleForFill = getEffectiveSegmentedDelayScaleLocal({
        requestedDelayScale: batchCommentFillOptions.delayScale,
        documentHidden: documentHiddenForFill,
        documentHasFocus: documentHasFocusForFill
      });
      logBatchSubmit('fill.segment_plan', {
        strategy: batchCommentFillPlan.strategy,
        chars: aiContent ? Array.from(aiContent).length : 0,
        prefixChars: batchCommentFillPlan.prefix.length,
        typedChars: batchCommentFillPlan.steps.length,
        suffixChars: batchCommentFillPlan.suffix.length,
        plannedDelayMs: batchCommentFillPlan.totalDelayMs,
        avgDelayMs: batchCommentFillPlan.avgDelayMs,
        maxDurationMs: batchCommentFillPlan.maxDurationMs,
        delayCapScale: batchCommentFillPlan.delayCapScale,
        effectiveDelayScale: effectiveDelayScaleForFill,
        documentHidden: documentHiddenForFill,
        documentHasFocus: documentHasFocusForFill,
        anchorDetected: batchCommentFillPlan.anchorDetected,
        hrefNewlinePreserved: batchCommentFillPlan.hrefNewlinePreserved,
        timeoutRisk: batchCommentFillPlan.totalDelayMs >= batchCommentFillPlan.maxDurationMs
      });
      const manualFillResult = await tryFillCommentTextareaWithPromotionHumanLike(aiContent, ta, batchCommentFillOptions);
      logBatchSubmit('fill.comment_done', {
        success: !!(manualFillResult && manualFillResult.success),
        strategy: manualFillResult && manualFillResult.strategy ? manualFillResult.strategy : '',
        chars: manualFillResult && Number.isFinite(manualFillResult.chars) ? manualFillResult.chars : 0,
        prefixChars: manualFillResult && Number.isFinite(manualFillResult.prefixChars) ? manualFillResult.prefixChars : 0,
        typedChars: manualFillResult && Number.isFinite(manualFillResult.typedChars) ? manualFillResult.typedChars : 0,
        suffixChars: manualFillResult && Number.isFinite(manualFillResult.suffixChars) ? manualFillResult.suffixChars : 0,
        durationMs: manualFillResult && Number.isFinite(manualFillResult.durationMs) ? manualFillResult.durationMs : 0,
        plannedDelayMs: manualFillResult && Number.isFinite(manualFillResult.plannedDelayMs) ? manualFillResult.plannedDelayMs : 0,
        avgDelayMs: manualFillResult && Number.isFinite(manualFillResult.avgDelayMs) ? manualFillResult.avgDelayMs : 0,
        maxDurationMs: manualFillResult && Number.isFinite(manualFillResult.maxDurationMs) ? manualFillResult.maxDurationMs : 0,
        effectiveDelayScale: manualFillResult && Number.isFinite(manualFillResult.effectiveDelayScale) ? manualFillResult.effectiveDelayScale : 0,
        documentHidden: !!(manualFillResult && manualFillResult.documentHidden),
        documentHasFocus: !!(manualFillResult && manualFillResult.documentHasFocus),
        anchorDetected: !!(manualFillResult && manualFillResult.anchorDetected),
        hrefNewlinePreserved: !!(manualFillResult && manualFillResult.hrefNewlinePreserved),
        error: manualFillResult && manualFillResult.error ? manualFillResult.error : '',
        filledLength: ta ? getCommentFieldText(ta).length : 0,
        filledCommentText: ta ? getCommentFieldText(ta) : ''
      });
      console.log('[content] BATCH_HANDLE 手动按钮同款填充结果:', manualFillResult);
      // AI 生成完成后再次确认评论框存在（表单可能通过3懒加载在生成期间加载好）
      form = findCommentForm();
      ta = findLikelyCommentTextarea({ allowGenericFallback: true });
      if (!form || !ta) {
        console.log('[content] AI生成后未找到评论框，再次触发展开...');
        await triggerCommentFormFlowForBatch(8000);
        await new Promise(resolve => setTimeout(resolve, 2000));
        form = findCommentForm();
        ta = findLikelyCommentTextarea({ allowGenericFallback: true });
      }
      if (!form || !ta) {
        console.log('[content] AI生成后常规找框仍未完成，再次使用手动按钮同款找框逻辑...');
        const manualTargets = await findCommentTargetsForBatchUsingManualFlow(12000);
        form = manualTargets.form;
        ta = manualTargets.textarea;
      }
      // 如果 AI 生成后仍然找不到评论框，记录警告但尝试填充（表单可能只是隐藏了）
      if (!form || !ta) {
        console.warn('[content] AI生成后仍未找到评论框，尝试继续填充（表单可能只是隐藏）');
      }
      // 预检查只验证姓名/邮箱/网站字段是否存在，不验证comment（尚未生成）
      logBatchSubmit('fill.fields_precheck_start');
      const fillResult = await ensureAllCommentFormFieldsFilled('', true);
      logBatchSubmit('fill.fields_precheck_done', {
        success: !!(fillResult && fillResult.success),
        missingFields: fillResult && fillResult.missingFields ? fillResult.missingFields : []
      });
      if (!fillResult.success) {
        throw new Error('表单字段缺失: ' + (fillResult.missingFields || []).join(', '));
      }
      logBatchSubmit('fill.fields_refill_start');
      let refillResult = await ensureAllCommentFormFieldsFilled('', true);
      logBatchSubmit('fill.fields_refill_done', {
        success: !!(refillResult && refillResult.success),
        missingFields: refillResult && refillResult.missingFields ? refillResult.missingFields : []
      });
      if (!refillResult.success && (refillResult.missingFields || []).includes('comment')) {
        const latestTextarea = ta || findLikelyCommentTextarea({ allowGenericFallback: true });
        logBatchSubmit('fill.comment_retry_start', {
          textareaId: latestTextarea && latestTextarea.id ? latestTextarea.id : '',
          textareaName: latestTextarea && latestTextarea.name ? latestTextarea.name : ''
        });
        const retryFillResult = await fillSpecificCommentTextareaHumanLike(latestTextarea, aiContent, batchCommentFillOptions);
        if (retryFillResult && retryFillResult.success) {
          refillResult = await ensureAllCommentFormFieldsFilled('', true);
        }
        logBatchSubmit('fill.comment_retry_done', {
          success: !!(refillResult && refillResult.success),
          strategy: retryFillResult && retryFillResult.strategy ? retryFillResult.strategy : '',
          chars: retryFillResult && Number.isFinite(retryFillResult.chars) ? retryFillResult.chars : 0,
          prefixChars: retryFillResult && Number.isFinite(retryFillResult.prefixChars) ? retryFillResult.prefixChars : 0,
          typedChars: retryFillResult && Number.isFinite(retryFillResult.typedChars) ? retryFillResult.typedChars : 0,
          suffixChars: retryFillResult && Number.isFinite(retryFillResult.suffixChars) ? retryFillResult.suffixChars : 0,
          durationMs: retryFillResult && Number.isFinite(retryFillResult.durationMs) ? retryFillResult.durationMs : 0,
          plannedDelayMs: retryFillResult && Number.isFinite(retryFillResult.plannedDelayMs) ? retryFillResult.plannedDelayMs : 0,
          avgDelayMs: retryFillResult && Number.isFinite(retryFillResult.avgDelayMs) ? retryFillResult.avgDelayMs : 0,
          maxDurationMs: retryFillResult && Number.isFinite(retryFillResult.maxDurationMs) ? retryFillResult.maxDurationMs : 0,
          anchorDetected: !!(retryFillResult && retryFillResult.anchorDetected),
          hrefNewlinePreserved: !!(retryFillResult && retryFillResult.hrefNewlinePreserved),
          fillSuccess: !!(retryFillResult && retryFillResult.success),
          fillError: retryFillResult && retryFillResult.error ? retryFillResult.error : '',
          missingFields: refillResult && refillResult.missingFields ? refillResult.missingFields : []
        });
      }
      if (!refillResult.success) {
        throw new Error('表单填充失败: ' + (refillResult.missingFields || []).join(', '));
      }

      logBatchSubmit('submit.ready_check_start');
      const promotionWebsiteForSubmit = await getWebsiteUrl();
      await ensureCommentReadyForSubmitWithRecovery(
        aiContent,
        form,
        ta,
        promotionWebsiteForSubmit,
        batchCommentFillOptions,
        'submit.ready'
      );

      const manualCheckBeforeSubmit = detectManualRequiredChallenge(form);
      if (manualCheckBeforeSubmit.found) {
        await reportManualRequiredAndClose(batchId, urlIndex, url, aiContent);
        return;
      }

      const batchPreSubmitDelayMs = 900;
      logBatchSubmit('submit.manual_like_delay_start', { delayMs: batchPreSubmitDelayMs });
      await new Promise(resolve => setTimeout(resolve, batchPreSubmitDelayMs));
      logBatchSubmit('submit.manual_like_delay_done', { delayMs: batchPreSubmitDelayMs });
      await ensureCommentReadyForSubmitWithRecovery(
        aiContent,
        form,
        ta,
        promotionWebsiteForSubmit,
        batchCommentFillOptions,
        'submit.final_ready'
      );

      // 提交前先写入 pending 结果（页面刷新后 batch.js 仍能立即读到）
      console.log('[content] pending结果写入完成');
      // 用 sendBeacon 异步发后台，sendBeacon 在页面卸载前一定会发出
      console.log('[content] 发送 sendBeacon...');
      console.log('[content] sendBeacon 已发出');

      console.log('[content] 7/7 点击提交按钮...');
      const preSubmitError = 'submit started; page changed before confirmation';
      await persistBatchSubmitContext(batchId, urlIndex, url, 'submitted_unconfirmed', aiContent, preSubmitError);
      logBatchSubmit('submit.pre_submit_recovery_saved', {
        result: buildPreSubmitRecoveryPayloadLocal({
          batchId,
          urlIndex,
          url,
          aiContent,
          errorMessage: preSubmitError
        }).result,
        reportSent: false
      });
      logBatchSubmit('submit.click_start', {
        commentLength: aiContent ? aiContent.length : 0,
        formId: form && form.id ? form.id : '',
        textareaId: ta && ta.id ? ta.id : '',
        textareaName: ta && ta.name ? ta.name : ''
      });
      const beforeSubmitUrl = window.location.href;
      const clickResult = await clickCommentSubmitButton(form);
      logBatchSubmit('submit.click_done', {
        success: !!(clickResult && clickResult.success),
        submitResult: clickResult && clickResult.submitResult ? clickResult.submitResult : '',
        submitMethod: clickResult && clickResult.submitMethod ? clickResult.submitMethod : '',
        error: clickResult && clickResult.error ? clickResult.error : ''
      });
      console.log('[content] 点击结果:', clickResult);
      if (!clickResult.success) {
        throw new Error(clickResult.error || '提交按钮点击失败');
      }

      const submitOutcome = await observeSubmitOutcome(clickResult, aiContent, ta, beforeSubmitUrl);
      const finalResult = submitOutcome.result;
      const finalError = finalResult === 'success' ? null : submitOutcome.reason;
      logBatchSubmit('submit.final_outcome', {
        triggerResult: clickResult.submitResult || '',
        finalResult,
        reason: submitOutcome.reason,
        confidence: submitOutcome.confidence,
        linkVerified: !!(submitOutcome.linkVerification && submitOutcome.linkVerification.linkVerified),
        matchedHref: submitOutcome.linkVerification ? submitOutcome.linkVerification.matchedHref : ''
      });

      await writePendingResult(batchId, urlIndex, url, finalResult, aiContent, finalError);
      if (finalResult === 'success') {
        await persistBatchSubmitContext(batchId, urlIndex, url, 'success', aiContent, null);
      }
      sendBeaconReport(batchId, urlIndex, finalResult, aiContent, finalError);
      console.log('[content] batch submit result saved after observation:', { finalResult, finalError });

      if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage) {
        const promotionWebsiteUrl = await getWebsiteUrl();
        const payload = buildBatchConfirmPayloadLocal({
          batchId,
          urlIndex,
          url: url || '',
          aiContent,
          result: finalResult,
          promotionWebsiteUrl,
          promotionWebsiteKey: normalizePromotionWebsiteKey(promotionWebsiteUrl),
          copyPromotionWebsiteKey: normalizePromotionWebsiteKey(promotionWebsiteUrl),
          errorMessage: finalError,
          linkVerified: !!(submitOutcome.linkVerification && submitOutcome.linkVerification.linkVerified),
          matchedHref: submitOutcome.linkVerification ? submitOutcome.linkVerification.matchedHref : '',
          linkVerification: submitOutcome.linkVerification || null
        });
        await new Promise((resolve) => {
          chrome.runtime.sendMessage(payload).then((res) => {
            console.log('[content] background response:', res);
            resolve(res);
          }).catch((err) => {
            console.warn('[content] background response failed:', err);
            resolve(null);
          });
        });
      }
      clearBatchSubmitContext();
      console.log('[content] handleBatchTask 完成 <<<', { batchId, urlIndex });
    } catch (err) {
      console.warn('[content] handleBatchTask 捕获错误:', err.message);
      clearBatchSubmitContext();

      // AI已生成但失败，尝试补偿积分
      if (aiGenerated) {
        const userId = await getUserId();
        if (userId) {
          try {
            console.info('[content][api] POST /refund-points', { userId, batchId, url });
            const refundRes = await fetch(`${API_BASE}/refund-points`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                userId,
                batchId,
                url,
                reason: err.message || 'Submit failed after AI generation'
              })
            });
            const refundData = await refundRes.json();
            if (refundData.success) {
              console.log('[content] refund no-op completed; remaining points:', refundData.remainingPoints);
            } else {
              console.warn('[content] refund no-op failed:', refundData.error);
            }
          } catch (refundErr) {
            console.error('[content] refund no-op request failed:', refundErr);
          }
        }
      }

      // 特殊错误：未找到评论框
      if (err.message === '__NO_COMMENT_BOX__') {
        console.log('[content] 未找到评论框，上报并关闭标签页');
        await writePendingResult(batchId, urlIndex, url, 'no_comment_box', null, '未找到评论框');
        // 使用 BATCH_HANDLE_CONFIRM 触发 background -> batch 的 BATCH_CONFIRMED 流程
        await new Promise((resolve) => {
          chrome.runtime.sendMessage({
            type: 'BATCH_HANDLE_CONFIRM',
            batchId,
            urlIndex,
            url: url || '',
            aiContent: '',
            result: 'no_comment_box',
            errorMessage: '未找到评论框'
          }).then((response) => {
            console.log('[content] no_comment_box BATCH_HANDLE_CONFIRM 响应:', response);
            resolve(response);
          }).catch((err) => {
            if (err.message && err.message.includes('message channel closed')) {
              console.log('[content] 消息通道已关闭（标签页可能已关闭），忽略错误');
            } else {
              console.warn('[content] no_comment_box 发送消息失败:', err);
            }
            resolve(null);
          });
        });
        // 关闭当前标签页
        setTimeout(() => {
          window.close();
        }, 1000);
        return;
      }
      
      await writePendingResult(batchId, urlIndex, url, 'fail', null, err.message || String(err));
      await reportBatchResult(batchId, urlIndex, 'fail', null, err.message || String(err), url);
      if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage) {
        const promotionWebsiteUrl = await getWebsiteUrl();
        await new Promise((resolve) => {
          chrome.runtime.sendMessage({
            type: 'BATCH_HANDLE_CONFIRM',
            batchId,
            urlIndex,
            url: url || '',
            aiContent: '',
            result: 'fail',
            promotionWebsiteUrl,
            promotionWebsiteKey: normalizePromotionWebsiteKey(promotionWebsiteUrl),
            errorMessage: err.message || String(err)
          }).then(resolve).catch(resolve);
        });
      }
      // 不主动关闭窗口，等待超时自动关闭
    } finally {
      await clearPendingBatchTaskIfMatches(batchId, urlIndex);
      if (runningBatchTaskKey === taskKey) {
        runningBatchTaskKey = null;
      }
    }
  }

  /**
   * 等待页面关键元素加载
   */
  function waitForPageReady() {
    return new Promise((resolve) => {
      // 等待评论框或页面加载完毕
      const maxWait = 20000;
      const start = Date.now();
      const check = () => {
        if (Date.now() - start > maxWait) {
          console.log('[content] waitForPageReady 超时，继续执行');
          resolve(); // 超时也继续
          return;
        }
        // 检查是否有评论相关元素（包括 textarea、#respond、评论区域等）
        const hasCommentArea =
          document.querySelector(
            'textarea[name*="comment" i], textarea[name*="reply" i], textarea[name*="message" i], ' +
            'textarea[name*="comentario" i], textarea[name*="comentário" i], ' +
            '#comment, #comments, .comment-form, #respond, .respond, .comment-respond, ' +
            '#comments-area, .comments-area, .comentarios, #comentarios, .comentario, ' +
            '.comment-list, .comment-section, .post-comments-area, ' +
            '[contenteditable="true"][class*="comment"], [contenteditable="true"][class*="comentario"]'
          ) ||
          document.querySelector('form[action*="comment"]');

        // 检测 Disqus 评论系统
        const hasDisqus = document.querySelector(
          '#disqus_thread, [id*="disqus"], iframe[src*="disqus"], .dsq-brlink'
        );

        if (hasDisqus) {
          console.log('[content] waitForPageReady 检测到 Disqus，尝试展开...');
          // 尝试点击 Disqus 展开按钮
          const disqusBtn = document.querySelector(
            '#disqus_thread a, [id*="disqus"] a, .dsq-brlink a, ' +
            '#disqus_thread button, [data-disqus-identifier]'
          );
          if (disqusBtn && !disqusBtn.hasAttribute('data-auto-comment-clicked')) {
            disqusBtn.setAttribute('data-auto-comment-clicked', 'true');
            disqusBtn.click();
            console.log('[content] 已点击 Disqus 展开按钮，等待加载...');
            setTimeout(check, 2000); // 等待 Disqus 加载 iframe
            return;
          }
        }

        if (hasCommentArea) {
          console.log('[content] waitForPageReady 检测到评论区域，等待2秒让JS渲染完');
          setTimeout(resolve, 2000); // 额外等2秒让JS渲染完
        } else {
          setTimeout(check, 500);
        }
      };
      check();
    });
  }

  /**
   * 检查 URL 是否已在 batchResults 中处理过
   */
  async function checkExistingBatchResult(batchId, url, urlIndex) {
    const promotionWebsiteUrl = await getWebsiteUrl();
    return new Promise((resolve) => {
      chrome.storage.local.get(['batchResults'], (data) => {
        const results = data.batchResults || [];
        // 只要这个 URL 之前成功处理过（不限 batchId），就跳过 AI 生成
        const currentBatchMatch = results.find((r) =>
          r.batchId === batchId &&
          r.urlIndex === urlIndex &&
          r.url === url &&
          (r.result === 'success' || r.result === 'success_pending_moderation') &&
          r.confirmedBy === BATCH_SUCCESS_CONFIRMATION_MARKER &&
          isSamePromotionWebsite(r.promotionWebsiteUrl, promotionWebsiteUrl) &&
          r.copyPromotionWebsiteKey === normalizePromotionWebsiteKey(promotionWebsiteUrl) &&
          isUsableGeneratedCopy(r.aiContent)
        );
        if (currentBatchMatch) {
          resolve(currentBatchMatch);
          return;
        }

        const match = results.find((r) => isConfirmedBatchSuccessRecord(r, url, promotionWebsiteUrl));
        resolve(match || null);
      });
    });
  }

  /**
   * 上报"已存在评论"状态：跳过 AI 生成，直接写结果并通知 background
   */
  async function reportAlreadyCommented(batchId, urlIndex, url, aiContent) {
    await writePendingResult(batchId, urlIndex, url, 'skipped', aiContent, 'already_commented');
    sendBeaconReport(batchId, urlIndex, 'skipped', aiContent, 'already_commented');
    if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage) {
      const promotionWebsiteUrl = await getWebsiteUrl();
      await new Promise((resolve) => {
        chrome.runtime.sendMessage({
          type: 'BATCH_HANDLE_CONFIRM',
          batchId,
          urlIndex,
          url: url || '',
          aiContent: aiContent || '',
          result: 'skipped',
          promotionWebsiteUrl,
          promotionWebsiteKey: normalizePromotionWebsiteKey(promotionWebsiteUrl),
          copyPromotionWebsiteKey: normalizePromotionWebsiteKey(promotionWebsiteUrl),
          errorMessage: 'already_commented'
        }).then(resolve).catch(resolve);
      });
    }
  }

  const MANUAL_REQUIRED_MESSAGE = '检测到验证码/反垃圾验证，请手动填写后提交';
  const MANUAL_REQUIRED_KEYWORDS = [
    'captcha',
    'aiowps-captcha',
    'captcha-answer',
    'anti-spam',
    'antispam',
    'spam',
    'verification',
    'verify',
    'human',
    'robot',
    'answer in digits',
    'enter an answer',
    'answer:',
    'math',
    'equation',
    'security question',
    '验证码',
    '反垃圾',
    '验证'
  ];
  const MANUAL_REQUIRED_WIDGET_SELECTORS = [
    '.g-recaptcha',
    '.h-captcha',
    '.cf-turnstile',
    '[data-sitekey]',
    '[name="g-recaptcha-response"]',
    '[name="h-captcha-response"]',
    '[name="cf-turnstile-response"]',
    'iframe[src*="recaptcha"]',
    'iframe[src*="hcaptcha"]',
    'iframe[src*="challenges.cloudflare.com"]',
    'iframe[title*="reCAPTCHA"]',
    'iframe[title*="captcha"]'
  ];

  function detectManualRequiredChallenge(form) {
    const targetForm = form || findCommentForm();
    logBatchSubmit('manual_check.start', {
      hasForm: !!targetForm,
      formId: targetForm && targetForm.id ? targetForm.id : '',
      formClass: targetForm && targetForm.className ? String(targetForm.className).slice(0, 120) : ''
    });
    if (!targetForm) {
      logBatchSubmit('manual_check.done', { found: false, reason: 'no_form' });
      return { found: false };
    }

    const widget = findManualRequiredWidget(targetForm);
    if (widget) {
      console.log('[AutoComment] 检测到需手动处理的人机验证组件:', {
        tag: widget.tagName,
        className: widget.className,
        src: widget.getAttribute && widget.getAttribute('src'),
        title: widget.getAttribute && widget.getAttribute('title')
      });
      logBatchSubmit('manual_check.done', {
        found: true,
        reason: 'widget',
        tag: widget.tagName || '',
        id: widget.id || '',
        className: widget.className ? String(widget.className).slice(0, 120) : '',
        src: widget.getAttribute && widget.getAttribute('src') ? widget.getAttribute('src').slice(0, 180) : '',
        title: widget.getAttribute && widget.getAttribute('title') ? widget.getAttribute('title').slice(0, 120) : ''
      });
      return { found: true, field: widget, message: MANUAL_REQUIRED_MESSAGE };
    }

    const candidateFields = Array.from(targetForm.querySelectorAll('input, textarea, select'))
      .filter((field) => isEmptyField(field) && isVisibleFormField(field));
    logBatchSubmit('manual_check.fields', {
      emptyVisibleFieldCount: candidateFields.length,
      fields: candidateFields.slice(0, 12).map((field) => ({
        tag: field.tagName || '',
        name: field.name || '',
        id: field.id || '',
        type: field.type || '',
        placeholder: field.placeholder || '',
        required: isRequiredField(field)
      }))
    });

    for (const field of candidateFields) {
      const text = getFieldContextText(field, targetForm).toLowerCase();
      const isRequiredManualField =
        isRequiredField(field) ||
        isLikelyManualChallengeField(field, targetForm, text);
      if (isRequiredManualField && MANUAL_REQUIRED_KEYWORDS.some((keyword) => text.includes(keyword.toLowerCase()))) {
        console.log('[AutoComment] 检测到需手动处理的验证/反垃圾字段:', {
          name: field.name,
          id: field.id,
          type: field.type,
          placeholder: field.placeholder,
          context: text.slice(0, 180)
        });
        logBatchSubmit('manual_check.done', {
          found: true,
          reason: 'field_keyword',
          name: field.name || '',
          id: field.id || '',
          type: field.type || '',
          placeholder: field.placeholder || '',
          context: text.slice(0, 240)
        });
        return { found: true, field, message: MANUAL_REQUIRED_MESSAGE };
      }
    }

    logBatchSubmit('manual_check.done', { found: false, reason: 'none' });
    return { found: false };
  }

  function findManualRequiredWidget(root) {
    for (const selector of MANUAL_REQUIRED_WIDGET_SELECTORS) {
      try {
        const node = root.querySelector(selector);
        if (node) return node;
      } catch (_) {}
    }
    return null;
  }

  function isLikelyManualChallengeField(field, form, contextText) {
    const name = (field.name || '').toLowerCase();
    const id = (field.id || '').toLowerCase();
    const className = (field.className || '').toLowerCase();
    const type = (field.type || '').toLowerCase();
    if (type === 'hidden' || type === 'submit' || type === 'button') return false;

    const text = `${name} ${id} ${className} ${contextText || ''}`;
    if (text.includes('aiowps-captcha') || text.includes('captcha-answer')) return true;
    if (text.includes('answer in digits') || text.includes('enter an answer')) return true;
    if (text.includes('equation') && (text.includes('captcha') || text.includes('='))) return true;

    const container = field.closest && field.closest('p, div, label, section');
    const containerText = ((container && container.textContent) || '').toLowerCase();
    return (
      containerText.includes('please enter an answer in digits') ||
      (containerText.includes('captcha') && containerText.includes('answer')) ||
      (containerText.includes('=') && containerText.includes('answer'))
    );
  }

  function isRequiredField(field) {
    return !!(field && (field.required || field.getAttribute('aria-required') === 'true'));
  }

  function isEmptyField(field) {
    if (!field) return false;
    const tag = (field.tagName || '').toLowerCase();
    const type = (field.type || '').toLowerCase();
    if (type === 'checkbox' || type === 'radio') return !field.checked;
    if (tag === 'select') return !field.value;
    return !(field.value || '').trim();
  }

  function isVisibleFormField(field) {
    if (!field || field.disabled) return false;
    const type = (field.type || '').toLowerCase();
    if (type === 'hidden') return false;
    const style = window.getComputedStyle(field);
    return style.display !== 'none' && style.visibility !== 'hidden';
  }

  function getFieldContextText(field, form) {
    const parts = [
      field.name,
      field.id,
      field.className,
      field.type,
      field.placeholder,
      field.getAttribute('aria-label'),
      field.getAttribute('title'),
      field.getAttribute('autocomplete')
    ];

    if (field.id && typeof CSS !== 'undefined' && CSS.escape) {
      try {
        const label = form.querySelector(`label[for="${CSS.escape(field.id)}"]`);
        if (label) parts.push(label.textContent);
      } catch (_) {}
    }

    const closestLabel = field.closest && field.closest('label');
    if (closestLabel) parts.push(closestLabel.textContent);

    const previous = field.previousElementSibling;
    if (previous && (previous.textContent || '').length < 120) parts.push(previous.textContent);

    const next = field.nextElementSibling;
    if (next && (next.textContent || '').length < 120) parts.push(next.textContent);

    return parts.filter(Boolean).join(' ');
  }

  async function reportManualRequiredAndClose(batchId, urlIndex, url, aiContent, errorMessage) {
    console.log('[content] 检测到需手动处理，上报 manual_required 并关闭网页:', { batchId, urlIndex, url });
    const finalErrorMessage = errorMessage || MANUAL_REQUIRED_MESSAGE;
    await writePendingResult(batchId, urlIndex, url, 'manual_required', aiContent || null, finalErrorMessage);
    sendBeaconReport(batchId, urlIndex, 'manual_required', aiContent || null, finalErrorMessage);

    if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage) {
      await new Promise((resolve) => {
        chrome.runtime.sendMessage({
          type: 'BATCH_HANDLE_CONFIRM',
          batchId,
          urlIndex,
          url: url || '',
          aiContent: aiContent || '',
          result: 'manual_required',
          errorMessage: finalErrorMessage
        }).then(resolve).catch(resolve);
      });
    }

    setTimeout(() => {
      window.close();
    }, 500);
  }

  async function reportTerminalBatchResultAndClose(batchId, urlIndex, url, result, aiContent, errorMessage) {
    console.log('[content] reportTerminalBatchResultAndClose >>>', { batchId, urlIndex, url, result, errorMessage });
    await writePendingResult(batchId, urlIndex, url, result, aiContent || null, errorMessage || null);
    sendBeaconReport(batchId, urlIndex, result, aiContent || null, errorMessage || null);

    if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage) {
      const promotionWebsiteUrl = await getWebsiteUrl();
      await new Promise((resolve) => {
        chrome.runtime.sendMessage(buildBatchConfirmPayloadLocal({
          batchId,
          urlIndex,
          url: url || '',
          aiContent: aiContent || '',
          result,
          promotionWebsiteUrl,
          promotionWebsiteKey: normalizePromotionWebsiteKey(promotionWebsiteUrl),
          copyPromotionWebsiteKey: normalizePromotionWebsiteKey(promotionWebsiteUrl),
          errorMessage: errorMessage || null
        })).then(resolve).catch(resolve);
      });
    }

    setTimeout(() => {
      window.close();
    }, 500);
  }

  /**
   * 将待确认结果写入 storage（页面刷新前同步落盘，batch.js 轮询可立即读到）
   */
  async function writePendingResult(batchId, urlIndex, url, result, aiContent, errorMessage) {
    console.log('[content] writePendingResult >>>', { batchId, urlIndex, url, result, aiContentLen: aiContent ? aiContent.length : 0, errorMessage });
    if (typeof chrome === 'undefined' || !chrome.storage) {
      console.warn('[content] writePendingResult: chrome.storage 不可用');
      return;
    }
    try {
      const promotionWebsiteUrl = await getWebsiteUrl();
      const data = await new Promise((resolve) => {
        chrome.storage.local.get(['batchResults', 'batchReportedUrls'], (d) => resolve(d));
      });
      const results = Array.isArray(data.batchResults) ? data.batchResults : [];
      const entry = {
        batchId,
        urlIndex,
        url: url || '',
        result,
        aiContent,
        errorMessage,
        promotionWebsiteUrl,
        promotionWebsiteKey: normalizePromotionWebsiteKey(promotionWebsiteUrl),
        copyPromotionWebsiteKey: normalizePromotionWebsiteKey(promotionWebsiteUrl),
        timestamp: Date.now()
      };
      if (result === 'success' || result === 'success_pending_moderation') {
        entry.confirmedBy = BATCH_SUCCESS_CONFIRMATION_MARKER;
        entry.confirmedAt = entry.timestamp;
      }
      const existingIndex = results.findIndex((item) => item.batchId === batchId && item.urlIndex === urlIndex);
      if (existingIndex >= 0) {
        results[existingIndex] = { ...results[existingIndex], ...entry };
      } else {
        results.push(entry);
      }
      if (results.length > 100) results.shift();
      const reported = Array.isArray(data.batchReportedUrls) ? data.batchReportedUrls : [];
      const urlKey = `${batchId}:${urlIndex}`;
      if (!reported.includes(urlKey)) {
        reported.push(urlKey);
        if (reported.length > 500) reported.shift();
      }
      await new Promise((resolve) => {
        chrome.storage.local.set({ batchResults: results, batchReportedUrls: reported }, resolve);
      });
      console.log('[content] writePendingResult <<< 写入完成, 当前results长度:', results.length);
    } catch (e) {
      console.error('[content] writePendingResult 错误:', e);
    }
  }

  /**
   * 用 navigator.sendBeacon 发后台（不受页面刷新影响，在 beforeunload 之前一定发出）
   */
  function sendBeaconReport(batchId, urlIndex, result, aiContent, errorMessage) {
    const payload = JSON.stringify({ urlIndex, result, aiContent, errorMessage });
    const url = `${API_BASE}/batch/${encodeURIComponent(batchId)}/report`;
    try {
      if (navigator.sendBeacon) {
        const sent = navigator.sendBeacon(url, payload);
        console.log('[AutoComment][api] sendBeacon /batch/:batchId/report', {
          sent,
          batchId,
          urlIndex,
          result
        });
      }
    } catch (e) {
      console.warn('[AutoComment] sendBeacon 失败:', e);
    }
  }
  async function reportBatchResult(batchId, urlIndex, result, aiContent, errorMessage, pageUrl) {
    const payload = {
      type: 'BATCH_REPORT_RESULT',
      batchId,
      urlIndex,
      url: pageUrl || '',
      result,
      aiContent,
      errorMessage
    };

    // 主路径：background 先落盘 storage 再 sendResponse；页面跳转/关页前必须 await，否则 batch 收不到成功
    if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage) {
      try {
        await new Promise((resolve, reject) => {
          chrome.runtime.sendMessage(payload, (response) => {
            if (chrome.runtime.lastError) {
              const errMsg = chrome.runtime.lastError.message || '';
              if (errMsg.includes('message channel closed')) {
                console.log('[AutoComment] 消息通道已关闭（标签页可能已关闭），忽略错误');
                resolve(null);
              } else {
                reject(new Error(errMsg));
              }
              return;
            }
            if (response && response.ok) {
              resolve(response);
            } else {
              reject(new Error((response && response.error) || 'background 上报失败'));
            }
          });
        });
        return;
      } catch (e) {
        console.warn('[AutoComment] sendMessage 上报失败，尝试本地写入 storage:', e);
      }
    }

    // 兜底：extension 上下文异常时仍尽量写入本地，供 batch 页轮询
    if (typeof chrome !== 'undefined' && chrome.storage) {
      try {
        const data = await new Promise((resolve) => {
          chrome.storage.local.get(['batchResults', 'batchReportedUrls'], (d) => resolve(d));
        });
        const results = Array.isArray(data.batchResults) ? data.batchResults : [];
        const entry = {
          batchId,
          urlIndex,
          url: pageUrl || '',
          result,
          aiContent,
          errorMessage,
          timestamp: Date.now()
        };
        const existingIndex = results.findIndex((item) => item.batchId === batchId && item.urlIndex === urlIndex);
        if (existingIndex >= 0) {
          results[existingIndex] = { ...results[existingIndex], ...entry };
        } else {
          results.push(entry);
        }
        if (results.length > 100) results.shift();
        const reported = Array.isArray(data.batchReportedUrls) ? data.batchReportedUrls : [];
        const urlKey = `${batchId}:${urlIndex}`;
        if (!reported.includes(urlKey)) {
          reported.push(urlKey);
          if (reported.length > 500) reported.shift();
        }
        await new Promise((resolve) => {
          chrome.storage.local.set({ batchResults: results, batchReportedUrls: reported }, resolve);
        });
      } catch (_) {}
    }
  }
})();
