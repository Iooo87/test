/**
 * ZeroBounce HubSpot Forms v4 email validation widget.
 *
 * Embed next to a HubSpot form (`.hs-form-frame` or `.hs-form-html`):
 *
 *   <script src=".../hubspot-forms-v4-validation.min.js"
 *     data-portal-id="YOUR_PORTAL_ID"
 *     data-form-id="YOUR_FORM_GUID"
 *     defer></script>
 *
 * Or: window.initializeZeroBounce({ portalId, hubspotFormId, ... })
 *
 * How it runs:
 *   Same-origin / raw-HTML embeds: finds email inputs, then validates 350ms
 *   after blur — or, when idleSeconds is set, only after that idle pause.
 *   Cross-origin V4 iframe embeds: HubSpot blocks parent DOM access, so the
 *   email is read via HubSpotFormsV4.getFieldValue / getFormFieldValues.
 *   Loader and logo are created with the iframe document and inserted next to
 *   the email field, same as the legacy ZBEHS widget. Submit is intercepted
 *   with an overlay on the iframe footer when the submit button cannot be
 *   disabled from the parent.
 *   Local syntax is checked first; only well-formed addresses are POSTed
 *   to members-api.
 *   In-page results show as an in-field spinner, then a check/cross plus the
 *   ZeroBounce logo.
 *
 * Booleans (data-* or JS): true | 1 | yes | on (any case). Anything else is false.
 *
 * Nothing about the verdict or the wording lives here. Which statuses pass,
 * whether free mailboxes are rejected, which hostnames may validate, and the
 * custom messages are all portal settings in the ZeroBounce backend: the
 * response's `pass` is taken as the verdict, and its `message` is shown as-is —
 * the did-you-mean prefix when `didYouMean` came with it, the invalid-email
 * text otherwise. See readApiMessages, which also accepts per-purpose fields
 * if they are ever added.
 *
 * Script attributes / JS keys:
 *
 *   data-portal-id / portalId  (required)
 *     HubSpot portal id. Falls back to the HubSpot embed node if omitted.
 *
 *   data-form-id / hubspotFormId
 *     HubSpot form GUID. Falls back to the HubSpot embed node if omitted.
 *
 *   data-idle-seconds / idleSeconds  (alias: data-idle)
 *     Seconds of no typing before auto-validate. Setting it replaces blur
 *     validation rather than adding to it, so an address is never checked
 *     twice; submitting early still forces a check.
 *     0 or omit = validate 350ms after blur only. Example: "2"
 *
 *   data-use-test-endpoint / useTestEndpoint  (alias: data-test-endpoint)
 *     true = test API (test-members-api). Omit/false = production (members-api).
 *
 *   data-timeout / timeout  (aliases: data-api-timeout, data-timeout-seconds,
 *                           apiTimeout, apiTimeoutSeconds)
 *     Seconds before a hung members-api request is aborted. Aborts fail-open
 *     (submit is re-enabled). Omit or invalid = 10. Example: "10"
 *
 * JS-only (no data-*):
 *   disableSubmitOnError  default true  — disable submit until the email passes
 *   hideResults           default false — hide in-field check/cross/spinner
 *                         (invalid / typo text still shows)
 *   email                 one-off address for initializeZeroBounce({ portalId, email })
 *                         Skips the API if local syntax is invalid.
 */
(function (root) {

  const zbLog = function () {
    const args = Array.prototype.slice.call(arguments);
    args.unshift('[ZB HS V4]');
    console.log.apply(console, args);
  };

  zbLog('script loaded', {
    href: typeof location !== 'undefined' ? location.href : '',
    currentScriptSrc: typeof document !== 'undefined' && document.currentScript
      ? document.currentScript.src
      : '',
  });

  const currentScript = typeof document !== 'undefined' ? document.currentScript : null;
  
  const VALIDATE_URL_TEST =
    'https://test-members-api.zerobounce.net/api/integration/hubspot-forms/validate/';
  const VALIDATE_URL_PROD =
    'https://members-api.zerobounce.net/api/integration/hubspot-forms/validate/';
  let validateUrl = VALIDATE_URL_PROD;

  const DEFAULT_API_TIMEOUT_SECONDS = 10;
  let validateTimeoutMs = DEFAULT_API_TIMEOUT_SECONDS * 1000;

  /**
   * Abort a hung validate fetch after config timeout, while still honoring
   * the caller's signal (retype/blur). Timeout is reported as TimeoutError
   * so the fail-open catch can re-enable submit; user abort stays AbortError.
   */
  const withValidationTimeout = (userSignal) => {
    const timeoutMs = validateTimeoutMs;
    if (!timeoutMs) {
      return { signal: userSignal, didTimeout: () => false, cleanup: () => {} };
    }
    const controller = new AbortController();
    let timedOut = false;
    const timeoutId = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeoutMs);
    const onUserAbort = () => {
      controller.abort();
    };
    if (userSignal) {
      if (userSignal.aborted) onUserAbort();
      else userSignal.addEventListener('abort', onUserAbort);
    }
    return {
      signal: controller.signal,
      didTimeout: () => timedOut,
      cleanup: () => {
        clearTimeout(timeoutId);
        if (userSignal) userSignal.removeEventListener('abort', onUserAbort);
      },
    };
  };

  /** POST { portalId, email } to the current validate URL (test or production). */
  const requestHubspotFormsValidation = async (portalId, email, signal) => {
    const body = { portalId: String(portalId), email: String(email) };
    zbLog('validate fetch start', { url: validateUrl, portalId: body.portalId, email: body.email });
    const timeoutHandle = withValidationTimeout(signal);
    let response;
    try {
      response = await fetch(validateUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: timeoutHandle.signal,
      });
    } catch (err) {
      zbLog('validate fetch threw', {
        name: err && err.name,
        message: err && err.message,
        timedOut: timeoutHandle.didTimeout(),
        userAborted: !!(signal && signal.aborted),
      });
      if (signal && signal.aborted) throw err;
      if (timeoutHandle.didTimeout()) {
        const timeoutErr = new Error('ZeroBounce validation request timed out');
        timeoutErr.name = 'TimeoutError';
        throw timeoutErr;
      }
      throw err;
    } finally {
      timeoutHandle.cleanup();
    }

    const result = await response.json();
    zbLog('validate fetch response', { http: response.status, ok: response.ok, result: result });
    if (!response.ok) {
      throw new Error('ZeroBounce validation HTTP ' + response.status);
    }
    return result;
  };

  /** Map API variants (catch_all, do-not-mail) onto ZeroBounce status slugs. */
  const normalizeZbStatus = (raw) => {
    const s = String(raw || '')
      .trim()
      .toLowerCase()
      .replace(/\s+/g, '_');
    if (!s) return '';
    if (s === 'catchall' || s === 'catch_all') return 'catch-all';
    if (s === 'do-not-mail' || s === 'donotmail') return 'do_not_mail';
    if (s === 'spam-trap' || s === 'spam_trap') return 'spamtrap';
    return s;
  };

  /** ZeroBounce `status` from a validate payload (supports nested body / email). */
  const extractValidationStatus = (result) => {
    if (!result) return '';
    const payload = result.body && typeof result.body === 'object' ? result.body : result;
    if (!payload || typeof payload !== 'object') return '';
    const nested =
      payload.email && typeof payload.email === 'object' ? payload.email : payload;
    const raw =
      nested.status ||
      payload.status ||
      nested.zb_status ||
      payload.zb_status ||
      '';
    if (typeof raw === 'string' && raw.trim()) return normalizeZbStatus(raw);
    if (typeof payload.valid === 'boolean' && payload.valid) return 'valid';
    if (typeof payload.pass === 'boolean' && payload.pass) return 'valid';
    return '';
  };

  /**
   * Whether this result should be treated as a pass in the form UI. The backend
   * has already applied the portal's accepted statuses and free-mailbox rule,
   * so its valid/pass verdict is taken at face value.
   */
  const isValidationPassed = (result) => {
    if (!result) return false;
    const payload = result.body && typeof result.body === 'object' ? result.body : result;
    if (typeof payload.valid === 'boolean') return payload.valid;
    if (typeof payload.pass === 'boolean') return payload.pass;
    if (typeof payload.status === 'string') return normalizeZbStatus(payload.status) === 'valid';
    return false;
  };

  /** ZeroBounce typo suggestion (`did_you_mean`), if the API returned one. */
  const extractDidYouMean = (result) => {
    if (!result) return '';
    const payload = result.body && typeof result.body === 'object' ? result.body : result;
    if (!payload || typeof payload !== 'object') return '';
    const nested =
      payload.email && typeof payload.email === 'object' ? payload.email : payload;
    const raw =
      nested.did_you_mean ||
      nested.didYouMean ||
      payload.did_you_mean ||
      payload.didYouMean ||
      '';
    return typeof raw === 'string' ? raw.trim() : '';
  };

  /**
   * Places a validate payload can carry portal settings: top level, body,
   * and any nested email / settings / config / validation object.
   */
  const collectPayloadScopes = (result) => {
    const scopes = [];
    const add = (obj) => {
      if (obj && typeof obj === 'object' && scopes.indexOf(obj) === -1) scopes.push(obj);
    };
    if (!result || typeof result !== 'object') return scopes;
    add(result);
    add(result.body);
    scopes.slice().forEach((scope) => {
      add(scope.email);
      add(scope.settings);
      add(scope.config);
      add(scope.validation);
    });
    return scopes;
  };

  /** First non-empty string found under any of `keys`, in any payload scope. */
  const pickPayloadString = (result, keys) => {
    const scopes = collectPayloadScopes(result);
    for (let i = 0; i < scopes.length; i++) {
      for (let k = 0; k < keys.length; k++) {
        const raw = scopes[i][keys[k]];
        if (typeof raw === 'string' && raw.trim()) return raw.trim();
      }
    }
    return '';
  };

  /** First boolean-ish value found under any of `keys`; null when unstated. */
  const pickPayloadBool = (result, keys) => {
    const scopes = collectPayloadScopes(result);
    for (let i = 0; i < scopes.length; i++) {
      for (let k = 0; k < keys.length; k++) {
        const raw = scopes[i][keys[k]];
        if (raw === true || raw === 1) return true;
        if (raw === false || raw === 0) return false;
        if (typeof raw === 'string' && raw.trim()) {
          if (/^(1|true|yes|on)$/i.test(raw.trim())) return true;
          if (/^(0|false|no|off)$/i.test(raw.trim())) return false;
        }
      }
    }
    return null;
  };

  // Backend setting names the validate response may use, camelCase or snake_case.
  const INVALID_MESSAGE_KEYS = [
    'customErrorMessage',
    'custom_error_message',
    'invalidMessage',
    'invalid_message',
    'invalidEmailMessage',
    'invalid_email_message',
    'errorMessage',
  ];
  const TYPO_MESSAGE_KEYS = [
    'typoErrorMessage',
    'typo_error_message',
    'typoMessage',
    'typo_message',
    'didYouMeanMessage',
    'did_you_mean_message',
  ];
  const TYPO_ENABLED_KEYS = [
    'typoValidationEnabled',
    'typo_validation_enabled',
    'validateTypos',
    'validate_typos',
    'typoValidation',
    'typo_validation',
  ];
  const UI_PROFILE_KEYS = ['showZeroBounceLogo', 'show_zerobounce_logo', 'showLogo'];

  /**
   * The single message members-api actually sends today, e.g.
   * { pass: false, status: "invalid", subStatus: "possible_typo",
   *   didYouMean: "mike@gmail.com", message: "<custom typo error>" }
   * Which setting it holds depends on the outcome, so it is read as the typo
   * prefix when a suggestion came with it and as the invalid text otherwise.
   */
  const GENERIC_MESSAGE_KEYS = ['message', 'validationMessage', 'validation_message'];

  /** The API's own verdict for the address. */
  const apiSaysFailed = (result) => {
    const verdict = pickPayloadBool(result, ['pass', 'valid']);
    if (verdict !== null) return verdict === false;
    return extractValidationStatus(result) !== 'valid';
  };

  /** Set input.value in a way HubSpot/React-style fields still see the change. */
  const setNativeInputValue = (input, value) => {
    const view = (input.ownerDocument && input.ownerDocument.defaultView) || window;
    const proto = view.HTMLInputElement && view.HTMLInputElement.prototype;
    const desc = proto && Object.getOwnPropertyDescriptor(proto, 'value');
    if (desc && typeof desc.set === 'function') desc.set.call(input, value);
    else input.value = value;
  };

  /** Fill the field with a full suggested email, or replace only the domain. */
  const applyDidYouMeanSuggestion = (input, suggestion) => {
    if (!suggestion) return;
    let next = suggestion;
    if (suggestion.indexOf('@') === -1) {
      const at = String(input.value || '').indexOf('@');
      next = at !== -1 ? input.value.slice(0, at + 1) + suggestion : suggestion;
    }
    setNativeInputValue(input, next);
  };

  const BLUR_VALIDATE_DELAY_MS = 350;
  /** Local-only check; malformed values never reach the validate API. */
  const EMAIL_SYNTAX_REGEX =
    /^[a-zA-Z0-9._%+=!?/|{}$^~`&#*-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/;

  const isEmailSyntaxValid = (value) => EMAIL_SYNTAX_REGEX.test(String(value || '').trim());

  /** Seconds of no typing in the email field before auto-validate; 0 = blur only. */
  const parseIdleSeconds = (raw) => {
    const n = parseFloat(raw);
    if (!Number.isFinite(n) || n <= 0) return 0;
    return n;
  };

  /** Seconds before a hung validate fetch is aborted; omit/invalid = 10. */
  const parseTimeoutSeconds = (raw) => {
    if (raw == null || raw === '') return DEFAULT_API_TIMEOUT_SECONDS;
    const n = parseFloat(raw);
    if (!Number.isFinite(n) || n <= 0) return DEFAULT_API_TIMEOUT_SECONDS;
    return n;
  };

  /** Script-tag / initializeZeroBounce booleans: true, 1, yes, on. */
  const parseBool = (raw) => {
    if (raw === true || raw === 1) return true;
    if (typeof raw !== 'string') return false;
    return /^(1|true|yes|on)$/i.test(raw.trim());
  };

  const UI_SALT = 'zb4:ui';
  const UI_FLAG_NO_WORDMARK = 1;

  /** FNV-1a 32-bit, base36. Must stay identical to the generator in the HubSpot app. */
  const foldToken = (str) => {
    let hash = 0x811c9dc5;
    for (let i = 0; i < str.length; i++) {
      hash ^= str.charCodeAt(i);
      hash =
        (hash + ((hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24))) >>> 0;
    }
    return hash.toString(36);
  };

  /**
   * Verified UI flag bits from data-key ("<mask>-<token>"). The token is derived
   * from the portal id, so a value lifted from another embed does not verify.
   * Missing, malformed, or unverified input yields 0 (nothing suppressed).
   */
  const readUiFlags = (raw, portalId) => {
    const id = String(portalId || '').trim();
    const match = /^(\d{1,3})-([0-9a-z]+)$/i.exec(String(raw || '').trim());
    if (!id || !match) return 0;
    const mask = parseInt(match[1], 10);
    if (!Number.isFinite(mask) || mask <= 0) return 0;
    return foldToken(id + UI_SALT + mask) === match[2].toLowerCase() ? mask : 0;
  };

  /** Portal and form ids from this script tag, falling back to the HubSpot embed node. */
  const readEmbedConfig = () => {
    const frame =
      typeof document !== 'undefined'
        ? document.querySelector('.hs-form-frame[data-portal-id], .hs-form-html[data-portal-id]')
        : null;
    zbLog('readEmbedConfig lookup', {
      hasCurrentScript: !!currentScript,
      frameTag: frame ? frame.tagName : null,
      frameClass: frame ? frame.className : null,
    });
    const idleRaw =
      (currentScript &&
        (currentScript.getAttribute('data-idle-seconds') ||
          currentScript.getAttribute('data-idle'))) ||
      '';
    const portalId =
      (currentScript && currentScript.getAttribute('data-portal-id')) ||
      (frame && frame.getAttribute('data-portal-id')) ||
      '';
    const config = {
      portalId: portalId,
      hubspotFormId:
        (currentScript && currentScript.getAttribute('data-form-id')) ||
        (frame && frame.getAttribute('data-form-id')) ||
        '',
      idleSeconds: parseIdleSeconds(idleRaw),
      uiFlags: readUiFlags(currentScript && currentScript.getAttribute('data-key'), portalId),
      useTestEndpoint: parseBool(
        currentScript &&
          (currentScript.getAttribute('data-use-test-endpoint') ||
            currentScript.getAttribute('data-test-endpoint')),
      ),
      timeoutSeconds: parseTimeoutSeconds(
        currentScript &&
          (currentScript.getAttribute('data-timeout') ||
            currentScript.getAttribute('data-api-timeout') ||
            currentScript.getAttribute('data-timeout-seconds')),
      ),
    };
    zbLog('readEmbedConfig result', {
      portalId: config.portalId,
      hubspotFormId: config.hubspotFormId,
      idleSeconds: config.idleSeconds,
      useTestEndpoint: config.useTestEndpoint,
      timeoutSeconds: config.timeoutSeconds,
      uiFlags: config.uiFlags,
    });
    return config;
  };

  // HubSpot embed roots and email field matchers
  const HUBSPOT_ROOT_SELECTOR = [
    'form[id^="hsForm_"]',
    '.hs-form-html',
    '.hs-form-frame',
    '.hsfc-Form',
    '.hs-form',
    '[data-form-id]',
    'hubspot-form',
  ].join(',');

  const EMAIL_FIELD_SELECTOR = 'input[type="email"], input[name="email"]';
  const STATUS_ICON_CLASS = 'zb-email-status-icon';
  const boundEmailInputs = new WeakSet();
  const watchedIframes = new WeakSet();
  const watchedIframeDocuments = new WeakSet();
  /** `formId:instanceId` keys already wired to the HubSpotFormsV4 iframe path. */
  const iframeFormBindKeys = new Set();
  let iframeApiMissingLogged = false;
  const IFRAME_GUARD_CLASS = 'zb-hs-iframe-submit-guard';
  const IFRAME_GUARD_SPINNER_CLASS = 'zb-hs-iframe-submit-guard-spinner';
  const IFRAME_GUARD_MSG_CLASS = 'zb-hs-iframe-submit-guard-msg';
  const IFRAME_GUARD_LOGO_CLASS = 'zb-hs-iframe-submit-guard-logo';
  const IFRAME_GUARD_TYPO_CLASS = 'zb-hs-iframe-submit-guard-typo';
  const IFRAME_LOADER_CONTAINER_CLASS = 'loaderContainer';
  const IFRAME_LOADER_CLASS = 'loader';
  const IFRAME_ICON_CLASS = 'zb-icon';
  /** Covers the usual V4 submit/next strip inside `.hs-form-frame`. */
  const IFRAME_SUBMIT_GUARD_HEIGHT_PX = 96;
  const FIELD_LOADER_CLASS = 'zb-email-field-loader';
  const INVALID_MSG_CLASS = 'zb-invalid-email-message';
  const DID_YOU_MEAN_CLASS = 'zb-did-you-mean';
  /** Click handler per input: apply suggestion then re-run validate. */
  const typoApplyHandlers = new WeakMap();
  /**
   * Custom messages as returned by the validate endpoint. A response that
   * carries no message at all (a passing address, say) leaves the last ones in
   * place, so a locally detected failure (bad syntax, no API call) can still
   * show the backend's text. apiTyposEnabled null = the API never said, so a
   * suggestion is shown whenever one comes back.
   */
  let apiInvalidMessage = '';
  let apiTypoErrorMessage = '';
  let apiTyposEnabled = null;
  let brandingHiddenByEmbed = false;
  let brandingHiddenByServer = null;

  /** Wordmark is suppressed only on an explicit signal; the server's wins if it sends one. */
  const brandingHidden = () =>
    brandingHiddenByServer !== null ? brandingHiddenByServer : brandingHiddenByEmbed;

  /** Read the custom messages / typo toggle out of a validate response. */
  const readApiMessages = (result) => {
    let invalid = pickPayloadString(result, INVALID_MESSAGE_KEYS);
    let typoPrefix = pickPayloadString(result, TYPO_MESSAGE_KEYS);
    const generic = pickPayloadString(result, GENERIC_MESSAGE_KEYS);

    // One `message` serves both purposes: the suggestion decides which it is.
    if (generic) {
      if (extractDidYouMean(result)) {
        if (!typoPrefix) typoPrefix = generic;
      } else if (!invalid && apiSaysFailed(result)) {
        invalid = generic;
      }
    }

    // Assign as a pair so a message meant for one slot cannot linger in the other.
    if (invalid || typoPrefix) {
      apiInvalidMessage = invalid;
      apiTypoErrorMessage = typoPrefix;
    }

    const typosEnabled = pickPayloadBool(result, TYPO_ENABLED_KEYS);
    if (typosEnabled !== null) apiTyposEnabled = typosEnabled;

    const showLogo = pickPayloadBool(result, UI_PROFILE_KEYS);
    if (showLogo !== null) brandingHiddenByServer = showLogo === false;
  };
  const ZB_LOGO_SRC =
    'https://www.zerobounce.net/cdn-cgi/image/fit=scale-down,format=auto,quality=100,height=23,metadata=none/logo.webp';

  // In-field spinner (while the validate request is in flight)

  /** Yellow/gray 15px spinner inside the email field. */
  const startLogoStyleSpinner = (spinner) => {
    spinner.style.border = '3px solid';
    spinner.style.borderColor = '#888 #fbdd46 #888 #fbdd46';
    spinner.style.borderRadius = '50%';
    spinner.style.width = '15px';
    spinner.style.height = '15px';
    spinner.style.boxSizing = 'border-box';
    spinner.style.flexShrink = '0';
    spinner.style.background = 'transparent';
    if (!spinner.__zbSpinning) {
      spinner.animate([{ transform: 'rotate(0deg)' }, { transform: 'rotate(360deg)' }], {
        duration: 2000,
        iterations: Infinity,
      });
      spinner.__zbSpinning = true;
    }
  };

  /** Create or reposition the in-field spinner overlay on the email input. */
  const ensureFieldLoader = (input, documentContext) => {
    const parent = input.parentNode;
    if (!parent) return null;

    let loader = Array.from(parent.children).find(
      (el) => el.classList && el.classList.contains(FIELD_LOADER_CLASS),
    );
    if (!loader) {
      loader = documentContext.createElement('div');
      loader.className = FIELD_LOADER_CLASS;
      loader.setAttribute('aria-hidden', 'true');
      loader.style.position = 'absolute';
      loader.style.zIndex = '1000';
      loader.style.pointerEvents = 'none';
      const view = documentContext.defaultView || window;
      const computed = view.getComputedStyle(parent);
      if (computed.position === 'static') parent.style.position = 'relative';
      let node = parent;
      for (let i = 0; i < 6 && node && node.style; i++) {
        node.style.overflow = 'visible';
        node = node.parentElement;
      }
      parent.appendChild(loader);
      startLogoStyleSpinner(loader);
    }

    const parentRect = parent.getBoundingClientRect();
    const inputRect = input.getBoundingClientRect();
    loader.style.left = inputRect.right - parentRect.left - 22 + 'px';
    loader.style.top = inputRect.top - parentRect.top + inputRect.height / 2 - 8 + 'px';
    return loader;
  };

  /** Show or hide the in-field spinner. */
  const setFieldLoaderVisible = (input, documentContext, visible) => {
    const parent = input.parentNode;
    if (!parent) return;
    const loader = Array.from(parent.children).find(
      (el) => el.classList && el.classList.contains(FIELD_LOADER_CLASS),
    );
    if (!visible) {
      if (loader) loader.style.display = 'none';
      return;
    }
    const next = ensureFieldLoader(input, documentContext);
    if (next) next.style.display = 'block';
  };

  /** ZeroBounce wordmark shown next to the in-field check/cross. */
  const createZeroBounceLogo = (documentContext, heightPx) => {
    const logo = (documentContext || document).createElement('img');
    logo.src = ZB_LOGO_SRC;
    logo.alt = '';
    logo.setAttribute('aria-hidden', 'true');
    logo.style.height = (heightPx || 16) + 'px';
    logo.style.width = 'auto';
    logo.style.display = 'block';
    logo.style.flexShrink = '0';
    logo.style.alignSelf = 'flex-end';
    logo.style.verticalAlign = 'bottom';
    return logo;
  };

  /** Fill a status icon: pending spinner, valid check, invalid/error cross, or hidden. */
  const applyStatusIconContent = (icon, status, documentContext) => {
    icon.innerHTML = '';
    icon.style.border = 'none';
    icon.style.background = 'transparent';
    icon.style.width = 'auto';
    icon.style.height = '16px';
    icon.style.display = 'flex';
    icon.style.flexDirection = 'row';
    icon.style.alignItems = 'flex-end';
    icon.style.justifyContent = 'flex-end';
    icon.style.gap = '6px';
    icon.style.overflow = 'visible';
    icon.style.zIndex = '1000';

    if (status === 'pending') {
      const spinner = (documentContext || document).createElement('div');
      spinner.setAttribute('aria-hidden', 'true');
      icon.appendChild(spinner);
      startLogoStyleSpinner(spinner);
      return;
    }

    if (status === 'valid') {
      const mark = (documentContext || document).createElement('span');
      mark.innerHTML = '&#x2714;';
      mark.style.color = '#16a34a';
      mark.style.fontSize = '16px';
      mark.style.fontWeight = '700';
      mark.style.lineHeight = '16px';
      mark.style.height = '16px';
      mark.style.display = 'block';
      mark.style.position = 'relative';
      mark.style.top = '4px';
      icon.appendChild(mark);
      if (!brandingHidden()) icon.appendChild(createZeroBounceLogo(documentContext, 16));
      icon.style.color = '#16a34a';
      return;
    }

    if (status === 'invalid' || status === 'error') {
      const mark = (documentContext || document).createElement('span');
      mark.innerHTML = '&#x2716;';
      mark.style.color = '#DC143C';
      mark.style.fontSize = '16px';
      mark.style.fontWeight = '700';
      mark.style.lineHeight = '16px';
      mark.style.height = '16px';
      mark.style.display = 'block';
      mark.style.position = 'relative';
      mark.style.top = '4px';
      icon.appendChild(mark);
      if (!brandingHidden()) icon.appendChild(createZeroBounceLogo(documentContext, 16));
      icon.style.color = '#DC143C';
      return;
    }

    icon.style.display = 'none';
  };

  /** Create the check/cross overlay on the email input (right side of the field). */
  const ensureFieldStatusIcon = (input, documentContext) => {
    const parent = input.parentNode;
    if (!parent) return null;

    let icon = Array.from(parent.children).find(
      (el) => el.classList && el.classList.contains(STATUS_ICON_CLASS)
    );

    if (!icon) {
      icon = documentContext.createElement('span');
      icon.className = STATUS_ICON_CLASS;
      icon.setAttribute('aria-hidden', 'true');
      icon.style.position = 'absolute';
      icon.style.fontSize = '18px';
      icon.style.fontWeight = '700';
      icon.style.lineHeight = '1';
      icon.style.pointerEvents = 'none';
      icon.style.zIndex = '20';
      icon.style.display = 'none';
      const view = documentContext.defaultView || window;
      const computed = view.getComputedStyle(parent);
      if (computed.position === 'static') parent.style.position = 'relative';
      parent.style.overflow = 'visible';
      parent.appendChild(icon);
    }

    icon.style.overflow = 'visible';
    icon.style.transform = 'translateY(-50%)';
    const parentRect = parent.getBoundingClientRect();
    const inputRect = input.getBoundingClientRect();
    icon.style.top = inputRect.top - parentRect.top + inputRect.height / 2 + 'px';
    icon.style.left = 'auto';
    icon.style.right = parentRect.right - inputRect.right + 8 + 'px';
    input.style.paddingRight = brandingHidden() ? '40px' : '100px';

    return icon;
  };

  /**
   * Match HubSpot's own field error text (.hs-error-msg): 1em #e51520 in
   * whatever font the surrounding form uses, so our messages sit alongside
   * HubSpot's without looking bolted on.
   */
  const applyHubSpotErrorTextStyle = (el) => {
    el.style.color = '#e51520';
    el.style.fontSize = '1em';
    el.style.fontFamily = 'inherit';
    el.style.fontWeight = '500';
    el.style.lineHeight = '1.3';
  };

  /** Show or hide the invalid-email (or free-email block) message under the field. */
  const setInvalidMessageVisible = (input, documentContext, visible, message) => {
    const parent = input.parentNode;
    if (!parent) return;

    let el = Array.from(parent.children).find(
      (node) => node.classList && node.classList.contains(INVALID_MSG_CLASS),
    );

    const text = String(message || '').trim();
    if (!visible || !text) {
      if (el) el.style.display = 'none';
      return;
    }

    if (!el) {
      el = documentContext.createElement('div');
      el.className = INVALID_MSG_CLASS;
      el.setAttribute('role', 'alert');
      applyHubSpotErrorTextStyle(el);
      el.style.marginTop = '6px';
      if (input.nextSibling) parent.insertBefore(el, input.nextSibling);
      else parent.appendChild(el);
    }
    el.textContent = text;
    el.style.display = 'block';
  };

  /** Show “Did you mean …?” unless the API said typo validation is off. */
  const setDidYouMeanVisible = (input, documentContext, suggestion) => {
    const parent = input.parentNode;
    if (!parent) return;

    let el = Array.from(parent.children).find(
      (node) => node.classList && node.classList.contains(DID_YOU_MEAN_CLASS),
    );

    const show = Boolean(suggestion && apiTyposEnabled !== false);
    if (!show) {
      if (el) el.style.display = 'none';
      return;
    }

    if (!el) {
      el = documentContext.createElement('div');
      el.className = DID_YOU_MEAN_CLASS;
      applyHubSpotErrorTextStyle(el);
      el.style.marginTop = '4px';
      const invalidEl = Array.from(parent.children).find(
        (node) => node.classList && node.classList.contains(INVALID_MSG_CLASS),
      );
      if (invalidEl && invalidEl.nextSibling) parent.insertBefore(el, invalidEl.nextSibling);
      else if (input.nextSibling) parent.insertBefore(el, input.nextSibling);
      else parent.appendChild(el);
    }

    el.innerHTML = '';
    const customPrefix = apiTypoErrorMessage;
    if (customPrefix) {
      const prefixText = /[\s]$/.test(customPrefix) ? customPrefix : customPrefix + ' ';
      el.appendChild(documentContext.createTextNode(prefixText));
    } else {
      el.appendChild(documentContext.createTextNode('Did you mean '));
    }
    const link = documentContext.createElement('button');
    link.type = 'button';
    link.textContent = suggestion;
    link.style.border = 'none';
    link.style.background = 'none';
    link.style.padding = '0';
    // Inherit the error color; the underline is what marks it clickable.
    link.style.color = 'inherit';
    link.style.cursor = 'pointer';
    link.style.font = 'inherit';
    link.style.textDecoration = 'underline';
    link.addEventListener('click', (event) => {
      event.preventDefault();
      applyDidYouMeanSuggestion(input, suggestion);
      const apply = typoApplyHandlers.get(input);
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
      if (typeof apply === 'function') apply();
      else input.dispatchEvent(new FocusEvent('blur', { bubbles: true }));
    });
    el.appendChild(link);
    if (!customPrefix) el.appendChild(documentContext.createTextNode('?'));
    el.style.display = 'block';
  };

  /**
   * Drive in-field UI: spinner while pending, then check/cross.
   * hideResults skips icons only; invalid / typo text still shows.
   */
  const setFieldStatusIcon = (input, documentContext, status, hideResults, suggestion) => {
    setInvalidMessageVisible(input, documentContext, status === 'invalid', apiInvalidMessage);
    setDidYouMeanVisible(
      input,
      documentContext,
      status === 'pending' || status === '' || status === 'error' ? '' : suggestion || '',
    );
    const doc = documentContext || (input && input.ownerDocument);
    const inIframe = !!(doc && doc.defaultView && doc.defaultView !== window);
    if (inIframe) {
      if (!status) {
        detachIframeLoaderBadge(input);
        return;
      }
      const container = attachIframeLoaderBadge(input, doc, hideResults);
      paintIframeLoaderBadge(container, doc, status, hideResults);
      return;
    }
    if (hideResults) return;
    const pending = status === 'pending';
    setFieldLoaderVisible(input, documentContext, pending);
    const icon = ensureFieldStatusIcon(input, documentContext);
    if (!icon) return;
    if (pending) {
      icon.style.display = 'none';
      return;
    }
    applyStatusIconContent(icon, status, documentContext);
  };

  /** Nearest HubSpot form/root wrapping an input (for hidden result fields). */
  const getHubSpotFieldHost = (input) =>
    input.closest('form') ||
    input.closest(HUBSPOT_ROOT_SELECTOR) ||
    input.parentNode;

  /** querySelectorAll that never throws (bad selectors / detached docs). */
  const queryAll = (root, selector) => {
    try {
      return root && root.querySelectorAll ? Array.from(root.querySelectorAll(selector)) : [];
    } catch (e) {
      return [];
    }
  };

  /** Same-origin iframe document, or null if cross-origin. */
  const getIframeDocument = (iframe, silent) => {
    try {
      const doc = iframe.contentDocument || iframe.contentWindow.document;
      if (!silent) {
        if (!doc) {
          zbLog('iframe document empty (likely cross-origin)', {
            src: iframe.src || '',
            id: iframe.id || '',
          });
        } else {
          zbLog('iframe document', {
            src: iframe.src || '',
            id: iframe.id || '',
            accessible: true,
          });
        }
      }
      return doc;
    } catch (e) {
      if (!silent) {
        zbLog('iframe document blocked (cross-origin)', {
          src: iframe.src || '',
          id: iframe.id || '',
          message: e && e.message,
        });
      }
      return null;
    }
  };

  /**
   * Email inputs that belong to this HubSpot form (DOM + iframes).
   * Matches type=email or name=email inside a HubSpot root.
   */
  const collectHubSpotEmailInputs = (root, hubspotFormId) => {
    const inputs = [];
    const seen = new Set();
    zbLog('collectHubSpotEmailInputs start', {
      hubspotFormId: hubspotFormId,
      htmlFrames: queryAll(document, '.hs-form-html').length,
      hsFrames: queryAll(document, '.hs-form-frame').length,
      iframes: queryAll(document, 'iframe').length,
    });

    const addInput = (input) => {
      if (!input || seen.has(input) || boundEmailInputs.has(input)) return;
      seen.add(input);
      inputs.push(input);
    };

    const scanContext = (ctx, insideHubSpot) => {
      if (!ctx) return;

      queryAll(ctx, EMAIL_FIELD_SELECTOR).forEach((input) => {
        const host = getHubSpotFieldHost(input);
        const inHubSpot =
          insideHubSpot ||
          (input.closest && input.closest(HUBSPOT_ROOT_SELECTOR));

        if (!inHubSpot) return;

        if (hubspotFormId) {
          const blob = [
            input.id || '',
            (host && host.id) || '',
            (host && host.getAttribute && host.getAttribute('data-form-id')) || '',
          ].join(' ');
          const matchesForm =
            blob.indexOf(hubspotFormId) !== -1 ||
            (input.closest && input.closest('[data-form-id="' + hubspotFormId + '"]'));

          if (!matchesForm && !insideHubSpot) return;
        }

        addInput(input);
      });

      queryAll(ctx, 'iframe[id^="hs-form-iframe"], iframe.hs-form-iframe').forEach((iframe) => {
        const doc = getIframeDocument(iframe);
        if (doc) scanContext(doc, true);
      });

      queryAll(ctx, HUBSPOT_ROOT_SELECTOR).forEach((container) => {
        const scope = container.shadowRoot || container;
        if (container.shadowRoot) scanContext(container.shadowRoot, true);
        queryAll(scope, 'iframe').forEach((iframe) => {
          const doc = getIframeDocument(iframe);
          if (doc) scanContext(doc, true);
        });
      });
    };

    scanContext(root, false);
    zbLog('collectHubSpotEmailInputs done', {
      found: inputs.length,
      ids: inputs.map((input) => input.id || input.name || ''),
    });
    return inputs;
  };

  const getHubSpotFormsV4Api = () => {
    try {
      return root.HubSpotFormsV4 || null;
    } catch (e) {
      return null;
    }
  };

  const isHubSpotEmailFieldName = (name) => {
    const leaf = String(name || '')
      .toLowerCase()
      .split('/')
      .pop()
      .split('.')
      .pop();
    return leaf === 'email';
  };

  const emailFromFormFields = (fields) => {
    if (!Array.isArray(fields)) return { name: '', value: '' };
    for (let i = 0; i < fields.length; i++) {
      const field = fields[i] || {};
      if (!isHubSpotEmailFieldName(field.name)) continue;
      const raw = field.value;
      const value = Array.isArray(raw) ? String(raw[0] || '').trim() : String(raw || '').trim();
      return { name: String(field.name), value: value };
    }
    return { name: '', value: '' };
  };

  const findHubSpotEmbedMount = (formId) => {
    const nodes = queryAll(document, '.hs-form-frame, .hs-form-html');
    if (formId) {
      const match = nodes.find((node) => node.getAttribute && node.getAttribute('data-form-id') === formId);
      if (match) return match;
    }
    return nodes[0] || null;
  };

  const findHubSpotFormIframe = (mount) => {
    if (!mount) return null;
    return (
      mount.querySelector("[id^='hs-form-iframe']") ||
      mount.querySelector('iframe.hs-form-iframe') ||
      mount.querySelector('iframe')
    );
  };

  const ensureIframeSubmitGuard = (mount) => {
    if (!mount) return null;
    const doc = mount.ownerDocument || document;
    const view = doc.defaultView || window;
    const computed = view.getComputedStyle ? view.getComputedStyle(mount) : null;
    if (!computed || computed.position === 'static') mount.style.position = 'relative';

    let guard = Array.from(mount.children).find(
      (node) => node.classList && node.classList.contains(IFRAME_GUARD_CLASS),
    );
    if (guard) return guard;

    guard = doc.createElement('div');
    guard.className = IFRAME_GUARD_CLASS;
    guard.setAttribute('role', 'status');
    guard.setAttribute('aria-live', 'polite');
    guard.style.position = 'absolute';
    guard.style.left = '0';
    guard.style.right = '0';
    guard.style.bottom = '0';
    guard.style.minHeight = IFRAME_SUBMIT_GUARD_HEIGHT_PX + 'px';
    guard.style.height = 'auto';
    guard.style.zIndex = '2147483646';
    guard.style.display = 'none';
    guard.style.boxSizing = 'border-box';
    guard.style.padding = '12px 16px';
    guard.style.background = 'rgba(255, 255, 255, 0.55)';
    guard.style.backdropFilter = 'blur(10px)';
    guard.style.webkitBackdropFilter = 'blur(10px)';
    guard.style.borderTop = '1px solid rgba(208, 208, 208, 0.7)';
    guard.style.boxShadow = '0 -2px 8px rgba(0,0,0,.08)';
    guard.style.cursor = 'not-allowed';
    guard.style.fontFamily = 'Arial, Helvetica, sans-serif';

    const row = doc.createElement('div');
    row.style.display = 'flex';
    row.style.flexDirection = 'row';
    row.style.alignItems = 'center';
    row.style.gap = '12px';

    const spinner = doc.createElement('div');
    spinner.className = IFRAME_GUARD_SPINNER_CLASS;
    startLogoStyleSpinner(spinner);
    spinner.style.width = '22px';
    spinner.style.height = '22px';
    spinner.style.borderWidth = '3px';
    spinner.style.display = 'none';
    spinner.style.flexShrink = '0';

    const msg = doc.createElement('div');
    msg.className = IFRAME_GUARD_MSG_CLASS;
    msg.style.flex = '1';
    msg.style.minWidth = '0';
    msg.style.fontSize = '14px';
    msg.style.lineHeight = '1.35';
    msg.style.fontWeight = '500';
    msg.style.color = '#33475b';

    const logo = createZeroBounceLogo(doc, 28);
    logo.className = IFRAME_GUARD_LOGO_CLASS;
    logo.style.alignSelf = 'center';
    logo.style.height = '28px';
    logo.style.display = brandingHidden() ? 'none' : 'block';

    row.appendChild(spinner);
    row.appendChild(msg);
    row.appendChild(logo);
    guard.appendChild(row);

    const typo = doc.createElement('div');
    typo.className = IFRAME_GUARD_TYPO_CLASS;
    typo.style.display = 'none';
    typo.style.marginTop = '6px';
    guard.appendChild(typo);

    mount.appendChild(guard);
    return guard;
  };

  const paintIframeSubmitGuard = (guard, state, hideResults, onApplySuggestion) => {
    if (!guard) return;
    const outcome = state.outcome;
    const suggestion = state.suggestion || '';
    const spinner = guard.querySelector('.' + IFRAME_GUARD_SPINNER_CLASS);
    const msg = guard.querySelector('.' + IFRAME_GUARD_MSG_CLASS);
    const logo = guard.querySelector('.' + IFRAME_GUARD_LOGO_CLASS);
    const typo = guard.querySelector('.' + IFRAME_GUARD_TYPO_CLASS);
    const doc = guard.ownerDocument || document;

    if (logo) logo.style.display = brandingHidden() ? 'none' : 'block';

    const show = outcome === 'pending' || outcome === 'invalid';
    guard.style.display = show ? 'block' : 'none';
    if (!show) return;

    if (typo) {
      typo.innerHTML = '';
      typo.style.display = 'none';
    }

    if (outcome === 'pending') {
      guard.style.borderTopColor = 'rgba(251, 221, 70, 0.9)';
      if (spinner) spinner.style.display = 'block';
      if (msg) {
        msg.style.color = '#33475b';
        msg.textContent = hideResults ? '' : 'Validating email…';
      }
      return;
    }

    guard.style.borderTopColor = 'rgba(220, 21, 60, 0.85)';
    if (spinner) spinner.style.display = 'none';
    if (msg) {
      applyHubSpotErrorTextStyle(msg);
      msg.style.flex = '1';
      msg.style.minWidth = '0';
      msg.textContent = apiInvalidMessage || 'Please enter a valid email address.';
    }

    if (
      typo &&
      suggestion &&
      apiTyposEnabled !== false &&
      typeof onApplySuggestion === 'function'
    ) {
      applyHubSpotErrorTextStyle(typo);
      typo.style.marginTop = '6px';
      const customPrefix = apiTypoErrorMessage;
      if (customPrefix) {
        typo.appendChild(
          doc.createTextNode(/[\s]$/.test(customPrefix) ? customPrefix : customPrefix + ' '),
        );
      } else {
        typo.appendChild(doc.createTextNode('Did you mean '));
      }
      const link = doc.createElement('button');
      link.type = 'button';
      link.textContent = suggestion;
      link.style.border = 'none';
      link.style.background = 'none';
      link.style.padding = '0';
      link.style.color = 'inherit';
      link.style.cursor = 'pointer';
      link.style.font = 'inherit';
      link.style.textDecoration = 'underline';
      link.addEventListener('click', (clickEvent) => {
        clickEvent.preventDefault();
        clickEvent.stopPropagation();
        onApplySuggestion(suggestion);
      });
      typo.appendChild(link);
      if (!customPrefix) typo.appendChild(doc.createTextNode('?'));
      typo.style.display = 'block';
    }
  };

  /** Same hanging badge as ZBEHS: created with the iframe document, sits under the email field. */
  const createIframeLoaderBadge = (iframeDocument, hideResults) => {
    const loaderContainer = iframeDocument.createElement('div');
    const loader = iframeDocument.createElement('div');
    const logo = iframeDocument.createElement('img');
    logo.src = ZB_LOGO_SRC;
    logo.alt = '';
    logo.setAttribute('aria-hidden', 'true');

    loaderContainer.classList.add(IFRAME_LOADER_CONTAINER_CLASS);
    loaderContainer.style.position = 'absolute';
    loaderContainer.style.right = '0';
    loaderContainer.style.borderRadius = '0 0 4px 4px';
    loaderContainer.style.backgroundColor = '#fff';
    loaderContainer.style.boxShadow = '0 2px 2px rgba(0,0,0,.2)';
    loaderContainer.style.display = 'flex';
    loaderContainer.style.alignItems = 'baseline';
    loaderContainer.style.padding = '3px 5px 5px';
    loaderContainer.style.height = '32px';
    loaderContainer.style.border = '1px solid #bbbbbb';
    loaderContainer.style.borderTop = 'none';
    loaderContainer.style.zIndex = '1000';

    if (hideResults) {
      loaderContainer.style.height = 'auto';
      loaderContainer.style.padding = '5px';
      loaderContainer.style.visibility = 'hidden';
    }

    loader.classList.add(IFRAME_LOADER_CLASS);
    startLogoStyleSpinner(loader);
    loader.style.marginRight = hideResults ? '0' : '8px';

    loaderContainer.__zbLoader = loader;
    loaderContainer.__zbLogo = logo;
    if (!hideResults && !brandingHidden()) loaderContainer.appendChild(logo);
    return loaderContainer;
  };

  const clearIframeLoaderIcons = (container) => {
    if (!container) return;
    Array.from(container.querySelectorAll('.' + IFRAME_ICON_CLASS)).forEach((node) => {
      if (node.parentNode === container) container.removeChild(node);
    });
  };

  const attachIframeLoaderBadge = (input, iframeDocument, hideResults) => {
    if (!input || !iframeDocument || !input.parentNode) return null;
    const parent = input.parentNode;
    parent.style.position = 'relative';
    let container = Array.from(parent.children).find(
      (node) => node.classList && node.classList.contains(IFRAME_LOADER_CONTAINER_CLASS),
    );
    if (!container) {
      container = createIframeLoaderBadge(iframeDocument, hideResults);
      parent.insertBefore(container, input.nextSibling);
      zbLog('iframe loader appended inside iframe', {
        input: input.name || input.id || '',
      });
    }
    container.style.right = 'calc(100% - ' + input.offsetWidth + 'px)';
    if (input.value) input.style.borderBottomRightRadius = '0';
    return container;
  };

  const detachIframeLoaderBadge = (input) => {
    if (!input || !input.parentNode) return;
    const parent = input.parentNode;
    const container = Array.from(parent.children).find(
      (node) => node.classList && node.classList.contains(IFRAME_LOADER_CONTAINER_CLASS),
    );
    if (container && container.parentNode === parent) parent.removeChild(container);
    input.style.removeProperty('border-bottom-right-radius');
  };

  const paintIframeLoaderBadge = (container, iframeDocument, outcome, hideResults) => {
    if (!container || !iframeDocument) return;
    const loader = container.__zbLoader;
    const safeRemoveLoader = () => {
      if (loader && loader.parentNode === container) container.removeChild(loader);
    };

    clearIframeLoaderIcons(container);

    if (!outcome || outcome === 'empty') {
      safeRemoveLoader();
      if (hideResults) container.style.visibility = 'hidden';
      return;
    }

    if (outcome === 'pending') {
      if (hideResults) container.style.visibility = 'visible';
      container.style.borderColor = 'rgba(82,168,236,.8)';
      if (loader && loader.parentNode !== container) {
        container.insertBefore(loader, container.firstChild);
      }
      return;
    }

    safeRemoveLoader();
    if (hideResults) {
      container.style.visibility = 'hidden';
      return;
    }

    const icon = iframeDocument.createElement('div');
    icon.classList.add(IFRAME_ICON_CLASS);
    icon.style.fontSize = '16px';
    icon.style.marginRight = '8px';
    if (outcome === 'valid') {
      container.style.borderColor = 'rgba(82,168,236,.8)';
      icon.innerHTML = '&#x2713;';
      icon.style.color = '#3cb043';
      icon.style.transform = 'scale(1.5, 1)';
    } else {
      container.style.borderColor = '#DC143C';
      icon.innerHTML = '&#x2718;';
      icon.style.color = '#DC143C';
    }
    container.insertBefore(icon, container.firstChild);
  };

  const findIframeEmailInput = (iframeDocument) => {
    if (!iframeDocument) return null;
    const inputs = queryAll(iframeDocument, EMAIL_FIELD_SELECTOR);
    return inputs[0] || null;
  };

  const applyIframeSuggestion = (current, suggestion) => {
    if (!suggestion) return current;
    if (suggestion.indexOf('@') === -1) {
      const at = String(current || '').indexOf('@');
      return at !== -1 ? current.slice(0, at + 1) + suggestion : suggestion;
    }
    return suggestion;
  };

  /**
   * Cross-origin V4 iframe: read the email through HubSpotFormsV4 (no iframe DOM).
   * Returns true once at least one matching form instance is bound.
   */
  const bindCrossOriginHubSpotForms = (config, event) => {
    const api = getHubSpotFormsV4Api();
    if (!api) {
      if (!iframeApiMissingLogged) {
        iframeApiMissingLogged = true;
        zbLog('iframe API skip: HubSpotFormsV4 missing');
      }
      return false;
    }
    iframeApiMissingLogged = false;

    const hubspotFormId = config.hubspotFormId || '';
    const forms = [];
    const addForm = (form) => {
      if (!form || forms.indexOf(form) !== -1) return;
      forms.push(form);
    };

    if (event && typeof api.getFormFromEvent === 'function') {
      try {
        addForm(api.getFormFromEvent(event));
      } catch (e) {
        zbLog('iframe API getFormFromEvent failed', { message: e && e.message });
      }
    }
    if (typeof api.getForms === 'function') {
      try {
        (api.getForms() || []).forEach(addForm);
      } catch (e) {
        zbLog('iframe API getForms failed', { message: e && e.message });
      }
    }

    zbLog('iframe API forms', { count: forms.length, hubspotFormId: hubspotFormId });

    forms.forEach((form) => {
      let formId = '';
      let instanceId = '';
      try {
        formId = typeof form.getFormId === 'function' ? String(form.getFormId() || '') : '';
        instanceId = typeof form.getInstanceId === 'function' ? String(form.getInstanceId() || '') : '';
      } catch (e) {
        zbLog('iframe API form id failed', { message: e && e.message });
      }
      if (hubspotFormId && formId && formId !== hubspotFormId) return;
      const key = formId + ':' + (instanceId || '0');
      if (iframeFormBindKeys.has(key)) return;
      iframeFormBindKeys.add(key);
      zbLog('iframe API bind', { formId: formId, instanceId: instanceId });
      watchHubSpotIframeForm(form, formId, config);
    });

    return iframeFormBindKeys.size > 0;
  };

  const watchHubSpotIframeForm = (form, formId, config) => {
    const disableSubmit =
      typeof config.disableSubmitOnError !== 'undefined' ? config.disableSubmitOnError : true;
    const hideResults = typeof config.hideResults !== 'undefined' ? config.hideResults : false;
    const idleMs = parseIdleSeconds(config.idleSeconds) * 1000;
    const debounceMs = idleMs > 0 ? idleMs : BLUR_VALIDATE_DELAY_MS;
    const mount = findHubSpotEmbedMount(formId);
    const guard = ensureIframeSubmitGuard(mount);

    zbLog('iframe API watch', {
      formId: formId,
      hasMount: !!mount,
      mountClass: mount ? mount.className : '',
      debounceMs: debounceMs,
    });

    let emailFieldName = '0-1/email';
    let currentEmail = '';
    let lastValidatedEmail = '';
    let lastOutcome = '';
    let lastSuggestion = '';
    let debounceTimer = null;
    let currentAbortController = null;
    let inFlight = false;
    let loggedMissingIframeUi = false;

    const resolveIframeUi = (silent) => {
      const iframe = findHubSpotFormIframe(mount);
      const iframeDocument = iframe ? getIframeDocument(iframe, silent) : null;
      const input = findIframeEmailInput(iframeDocument);
      return { iframe: iframe, iframeDocument: iframeDocument, input: input };
    };

    const setSubmitBlocked = (blocked) => {
      if (!disableSubmit) return;
      const ui = resolveIframeUi(true);
      const button =
        ui.iframeDocument && ui.iframeDocument.querySelector
          ? ui.iframeDocument.querySelector("[type='submit']")
          : null;
      if (button) button.disabled = !!blocked;
    };

    const applySuggestion = (suggestion) => {
      const next = applyIframeSuggestion(currentEmail, suggestion);
      zbLog('iframe API apply suggestion', { from: currentEmail, to: next });
      try {
        if (typeof form.setFieldValue === 'function') form.setFieldValue(emailFieldName, next);
      } catch (e) {
        zbLog('iframe API setFieldValue failed', { message: e && e.message });
      }
      currentEmail = next;
      lastValidatedEmail = '';
      lastOutcome = '';
      lastSuggestion = '';
      runValidate();
    };

    const paint = () => {
      const outcome = String(currentEmail || '').trim() ? lastOutcome || 'empty' : 'empty';
      if (disableSubmit) {
        paintIframeSubmitGuard(
          guard,
          { outcome: outcome, suggestion: lastSuggestion },
          hideResults,
          applySuggestion,
        );
      } else if (guard) {
        guard.style.display = 'none';
      }
      const ui = resolveIframeUi(true);
      if (!ui.iframeDocument || !ui.input) {
        if (!loggedMissingIframeUi) {
          loggedMissingIframeUi = true;
          zbLog('iframe inner badge skipped (using submit guard)', {
            hasIframe: !!ui.iframe,
            hasDoc: !!ui.iframeDocument,
            hasInput: !!ui.input,
          });
        }
        return;
      }
      if (outcome === 'empty') {
        detachIframeLoaderBadge(ui.input);
        return;
      }
      const container = attachIframeLoaderBadge(ui.input, ui.iframeDocument, hideResults);
      paintIframeLoaderBadge(container, ui.iframeDocument, outcome, hideResults);
    };

    const runValidate = async () => {
      const email = String(currentEmail || '').trim();
      zbLog('iframe API runValidate', { email: email, field: emailFieldName });
      if (!email) {
        lastValidatedEmail = '';
        lastOutcome = '';
        lastSuggestion = '';
        setSubmitBlocked(false);
        paint();
        return;
      }
      if (!isEmailSyntaxValid(email)) {
        lastValidatedEmail = email;
        lastOutcome = 'invalid';
        lastSuggestion = '';
        setSubmitBlocked(true);
        paint();
        return;
      }
      if (currentAbortController) currentAbortController.abort();
      currentAbortController = new AbortController();
      const signal = currentAbortController.signal;
      inFlight = true;
      lastOutcome = 'pending';
      lastSuggestion = '';
      setSubmitBlocked(true);
      paint();
      try {
        const result = await requestHubspotFormsValidation(config.portalId, email, signal);
        if (signal.aborted) return;
        readApiMessages(result);
        const isValid = isValidationPassed(result);
        lastValidatedEmail = email;
        lastOutcome = isValid ? 'valid' : 'invalid';
        lastSuggestion = isValid ? '' : extractDidYouMean(result);
        setSubmitBlocked(!isValid);
        zbLog('iframe API result', { pass: isValid, suggestion: lastSuggestion });
      } catch (error) {
        if (error && error.name === 'AbortError') {
          zbLog('iframe API aborted');
          return;
        }
        zbLog('iframe API error', { name: error && error.name, message: error && error.message });
        lastValidatedEmail = email;
        lastOutcome = 'error';
        lastSuggestion = '';
        setSubmitBlocked(false);
      } finally {
        if (currentAbortController && currentAbortController.signal === signal) {
          currentAbortController = null;
        }
        inFlight = false;
        paint();
      }
    };

    const scheduleValidate = () => {
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        debounceTimer = null;
        runValidate();
      }, debounceMs);
    };

    const readEmail = async () => {
      try {
        if (typeof form.getFormFieldValues === 'function') {
          const fields = await form.getFormFieldValues();
          const picked = emailFromFormFields(fields);
          if (picked.name) emailFieldName = picked.name;
          return picked.value;
        }
      } catch (e) {
        zbLog('iframe API getFormFieldValues failed', { message: e && e.message });
      }
      if (typeof form.getFieldValue === 'function') {
        try {
          const value = await form.getFieldValue(emailFieldName);
          return Array.isArray(value) ? String(value[0] || '').trim() : String(value || '').trim();
        } catch (e) {
          zbLog('iframe API getFieldValue failed', {
            field: emailFieldName,
            message: e && e.message,
          });
        }
      }
      return '';
    };

    const tick = async () => {
      const next = await readEmail();
      if (next === currentEmail) return;
      zbLog('iframe API email changed', { from: currentEmail, to: next });
      currentEmail = next;
      if (currentAbortController) {
        currentAbortController.abort();
        currentAbortController = null;
      }
      if (!String(next || '').trim()) {
        if (debounceTimer) {
          clearTimeout(debounceTimer);
          debounceTimer = null;
        }
        lastValidatedEmail = '';
        lastOutcome = '';
        lastSuggestion = '';
        setSubmitBlocked(false);
        paint();
        return;
      }
      scheduleValidate();
    };

    tick();
    setInterval(tick, 250);
    if (typeof root.addEventListener === 'function') {
      root.addEventListener('hs-form-event:on-interaction:navigate', () => {
        tick();
      });
    }
  };

  /**
   * Public entry: merge script-tag + JS config, bind the form.
   * Optional config.email runs one API call (syntax-checked) and returns the payload.
   */
  const initializeZeroBounce = async (configOrPortalId, maybeEmail) => {
    zbLog('initializeZeroBounce', {
      argType: typeof configOrPortalId,
      maybeEmail: maybeEmail || '',
    });
    const scriptConfig = readEmbedConfig();
    const config =
      typeof configOrPortalId === 'object' && configOrPortalId !== null
        ? Object.assign({}, scriptConfig, configOrPortalId)
        : Object.assign({}, scriptConfig, { portalId: configOrPortalId, email: maybeEmail });

    config.idleSeconds = parseIdleSeconds(config.idleSeconds);
    const timeoutRaw =
      config.timeout != null && config.timeout !== ''
        ? config.timeout
        : config.apiTimeout != null && config.apiTimeout !== ''
          ? config.apiTimeout
          : config.apiTimeoutSeconds != null && config.apiTimeoutSeconds !== ''
            ? config.apiTimeoutSeconds
            : config.timeoutSeconds;
    config.timeoutSeconds = parseTimeoutSeconds(timeoutRaw);
    validateTimeoutMs = config.timeoutSeconds * 1000;
    validateUrl = parseBool(config.useTestEndpoint)
      ? VALIDATE_URL_TEST
      : VALIDATE_URL_PROD;

    // Read from scriptConfig, never the merged config: a caller-supplied uiFlags
    // would otherwise skip the token check entirely.
    brandingHiddenByEmbed =
      (Number(scriptConfig.uiFlags) & UI_FLAG_NO_WORDMARK) === UI_FLAG_NO_WORDMARK;

    if (!config.portalId) {
      console.warn('[ZeroBounce] data-portal-id is required');
      zbLog('initializeZeroBounce stop: missing portalId');
      return;
    }

    zbLog('initializeZeroBounce bind', {
      portalId: config.portalId,
      hubspotFormId: config.hubspotFormId,
      idleSeconds: config.idleSeconds,
      validateUrl: validateUrl,
      timeoutSeconds: config.timeoutSeconds,
      brandingHiddenByEmbed: brandingHiddenByEmbed,
    });

    if (typeof document !== 'undefined') {
      bindHubspotFormValidation(config);
    } else {
      zbLog('initializeZeroBounce skip bind: no document');
    }

    if (config.email) {
      zbLog('initializeZeroBounce one-off email', { email: config.email });
      if (!isEmailSyntaxValid(config.email)) {
        zbLog('initializeZeroBounce one-off email skipped: bad syntax');
        return;
      }
      return requestHubspotFormsValidation(config.portalId, String(config.email).trim());
    }
  };

  /**
   * Find HubSpot email inputs, bind blur/idle, call the validate API,
   * and update the in-field spinner/check/cross.
   */
  function bindHubspotFormValidation(config) {
    zbLog('bindHubspotFormValidation');
    /** Calls members-backend; writes hidden zb_validation_* fields and the in-field icon. */
    class ZeroBounceApi {
      constructor(portalId, disableSubmit, hideResults, documentContext) {
        this.portalId = portalId;
        this.disableSubmit = disableSubmit;
        this.hideResults = hideResults;
        this.document = documentContext;
      }

      /** Validate one email. Bad syntax → invalid UI, no fetch. Retype aborts in-flight requests. */
      async validate(input, button, signal) {
        zbLog('validate()', { email: String(input.value || '').trim(), hasButton: !!button });
        const host = getHubSpotFieldHost(input);
        const documentContext = this.document;
        if (!host) {
          zbLog('validate() stop: no host');
          return;
        }

        const email = String(input.value || '').trim();

        let validationResultInput = host.querySelector('input[name="zb_validation_result"]');
        let validationResponseInput = host.querySelector('input[name="zb_validation_response"]');

        if (!validationResultInput) {
          validationResultInput = documentContext.createElement('input');
          validationResultInput.type = 'hidden';
          validationResultInput.name = 'zb_validation_result';
          host.appendChild(validationResultInput);
        }

        if (!validationResponseInput) {
          validationResponseInput = documentContext.createElement('input');
          validationResponseInput.type = 'hidden';
          validationResponseInput.name = 'zb_validation_response';
          host.appendChild(validationResponseInput);
        }

        if (!isEmailSyntaxValid(email)) {
          zbLog('validate() local syntax fail', { email: email });
          if (!this.hideResults) input.style.borderColor = '#DC143C';
          if (this.disableSubmit && button) button.disabled = true;
          validationResultInput.value = 'invalid';
          validationResponseInput.value = '';
          setFieldStatusIcon(input, documentContext, 'invalid', this.hideResults, '');
          return { status: 'invalid', email: email };
        }

        try {
          const result = await requestHubspotFormsValidation(this.portalId, email, signal);
          readApiMessages(result);
          const isValid = isValidationPassed(result);
          const suggestion = extractDidYouMean(result);

          if (this.disableSubmit && button) button.disabled = !isValid;
          validationResultInput.value = isValid ? 'valid' : 'invalid';
          validationResponseInput.value = JSON.stringify(result);
          setFieldStatusIcon(
            input,
            documentContext,
            isValid ? 'valid' : 'invalid',
            this.hideResults,
            suggestion,
          );

          if (!this.hideResults) {
            if (isValid) input.style.removeProperty('border-color');
            else input.style.borderColor = '#DC143C';
          }

          zbLog('validate() result', {
            status: isValid ? 'valid' : 'invalid',
            pass: isValid,
            suggestion: suggestion,
          });
          return { status: isValid ? 'valid' : 'invalid', email: email, result: result };
        } catch (error) {
          if (error.name === 'AbortError') {
            zbLog('validate() aborted');
            return { status: 'aborted' };
          }
          console.error('Validation error:', error);
          zbLog('validate() error', { name: error.name, message: error.message });
          if (!this.hideResults) input.style.borderColor = '#DC143C';
          if (this.disableSubmit && button) button.disabled = false;
          validationResultInput.value = 'error';
          setFieldStatusIcon(input, documentContext, 'error', this.hideResults);
          return { status: 'error', email: email };
        }
      }
    }

    const disableSubmit = typeof config.disableSubmitOnError !== 'undefined' ? config.disableSubmitOnError : true;
    const hideResults = typeof config.hideResults !== 'undefined' ? config.hideResults : false;
    const hubspotFormId = config.hubspotFormId || '';

    /**
     * Re-scan accessible HubSpot iframe documents after they load and whenever
     * their form DOM changes. Cross-origin HubSpot iframes remain inaccessible
     * by browser policy; those require the validation script to run inside the
     * iframe or a raw-HTML/developer embed.
     */
    const watchAccessibleHubSpotIframes = () => {
      queryAll(document, 'iframe').forEach((iframe) => {
        const belongsToHubSpot =
          (iframe.matches &&
            iframe.matches('iframe[id^="hs-form-iframe"], iframe.hs-form-iframe')) ||
          (iframe.closest && iframe.closest(HUBSPOT_ROOT_SELECTOR));

        if (!belongsToHubSpot) return;

        if (!watchedIframes.has(iframe)) {
          watchedIframes.add(iframe);
          iframe.addEventListener('load', attachToFoundInputs);
        }

        const iframeDocument = getIframeDocument(iframe);
        if (!iframeDocument || !iframeDocument.documentElement) {
          zbLog('iframe watch skip: not accessible', {
            src: iframe.src || '',
            id: iframe.id || '',
          });
          return;
        }
        if (watchedIframeDocuments.has(iframeDocument)) return;

        zbLog('iframe watch attach observer');

        watchedIframeDocuments.add(iframeDocument);
        const iframeObserver = new MutationObserver(attachToFoundInputs);
        iframeObserver.observe(iframeDocument.documentElement, {
          childList: true,
          subtree: true,
        });
      });
    };

    /** Scan the page for unbound email inputs and attach validation. */
    const attachToFoundInputs = () => {
      zbLog('attachToFoundInputs');
      watchAccessibleHubSpotIframes();
      const found = collectHubSpotEmailInputs(document, hubspotFormId);
      zbLog('attachToFoundInputs found', { count: found.length });
      const byDoc = new Map();

      found.forEach((input) => {
        const doc = input.ownerDocument || document;
        if (!byDoc.has(doc)) byDoc.set(doc, []);
        byDoc.get(doc).push(input);
      });

      byDoc.forEach((docInputs, doc) => {
        processValidation(
          doc,
          docInputs,
          disableSubmit,
          hideResults,
          config.portalId,
          config.idleSeconds,
        );
      });

      if (!found.length) bindCrossOriginHubSpotForms(config);
    };

    attachToFoundInputs();

    root.addEventListener('hs-form-event:on-ready', (event) => {
      zbLog('hs-form-event:on-ready', event && event.detail);
      attachToFoundInputs();
      bindCrossOriginHubSpotForms(config, event);
    });

    if (Array.isArray(root.hsFormsOnReady)) {
      root.hsFormsOnReady.push(attachToFoundInputs);
    } else {
      root.hsFormsOnReady = [attachToFoundInputs];
    }

    if (!root.__zbHubspotV4Watching) {
      root.__zbHubspotV4Watching = true;
      let bindTimer;
      const observer = new MutationObserver(() => {
        clearTimeout(bindTimer);
        bindTimer = setTimeout(attachToFoundInputs, 250);
      });
      observer.observe(document.documentElement, { childList: true, subtree: true });
    }

    if (!root.__zbHubspotV4IframeRetry) {
      let iframeApiTries = 0;
      root.__zbHubspotV4IframeRetry = setInterval(() => {
        iframeApiTries += 1;
        if (bindCrossOriginHubSpotForms(config) || iframeApiTries > 80) {
          clearInterval(root.__zbHubspotV4IframeRetry);
          root.__zbHubspotV4IframeRetry = null;
        }
      }, 250);
    }

    /**
     * Per-input listeners. The two triggers are exclusive: with idleSeconds set
     * the address is validated after that many seconds of no typing and blur is
     * ignored, otherwise it is validated 350ms after blur. Submit is disabled as
     * soon as blur validation is scheduled, and submit/Enter is blocked while a
     * check is pending, so the delay cannot post; in idle mode submitting before
     * the timer fires validates immediately. Syntax failures skip the pending
     * spinner and the API.
     */
    function processValidation(
      documentContext,
      inputs,
      disableSubmit,
      hideResults,
      portalId,
      idleSeconds,
    ) {
      const unbound = inputs.filter((input) => !boundEmailInputs.has(input));
      zbLog('processValidation', {
        inputs: inputs.length,
        unbound: unbound.length,
        idleSeconds: idleSeconds,
      });
      unbound.forEach((input) => boundEmailInputs.add(input));
      if (!unbound.length) {
        zbLog('processValidation: nothing new to bind');
        return;
      }

      const zb = new ZeroBounceApi(portalId, disableSubmit, hideResults, documentContext);
      const idleMs = parseIdleSeconds(idleSeconds) * 1000;
      /** idleSeconds set: the idle timer is the only trigger, blur never validates. */
      const idleOnly = idleMs > 0;

      unbound.forEach((input) => {
        let blurTimer = null;
        let idleTimer = null;
        let currentAbortController = null;

        const getSubmitButton = () => {
          const host = getHubSpotFieldHost(input);
          return host ? host.querySelector("[type='submit']") : null;
        };

        const setSubmitBlocked = (blocked) => {
          if (!disableSubmit) return;
          const button = getSubmitButton();
          if (button) button.disabled = !!blocked;
        };

        let lastValidatedEmail = '';
        let lastOutcome = '';

        /** Empty is not invalid: drop error UI and allow submit again. */
        const clearEmptyFieldValidation = () => {
          lastValidatedEmail = '';
          lastOutcome = '';
          setFieldStatusIcon(input, documentContext, '', hideResults, '');
          if (!hideResults) input.style.removeProperty('border-color');
          setSubmitBlocked(false);
          const host = getHubSpotFieldHost(input);
          if (!host) return;
          const resultInput = host.querySelector('input[name="zb_validation_result"]');
          const responseInput = host.querySelector('input[name="zb_validation_response"]');
          if (resultInput) resultInput.value = '';
          if (responseInput) responseInput.value = '';
        };

        const emailIsAllowedToSubmit = () => {
          const email = String(input.value || '').trim();
          if (!email) return true;
          if (blurTimer || currentAbortController) return false;
          if (lastValidatedEmail !== email) return false;
          return lastOutcome === 'valid' || lastOutcome === 'error';
        };

        const runValidate = async () => {
          zbLog('runValidate', { value: String(input.value || '').trim() });
          if (String(input.value || '').trim() === '') {
            clearEmptyFieldValidation();
            return;
          }
          // Malformed: mark invalid locally, do not show spinner or call the API.
          if (!isEmailSyntaxValid(input.value)) {
            const button = getSubmitButton();
            setSubmitBlocked(true);
            const outcome = await zb.validate(input, button);
            if (outcome && outcome.status !== 'aborted') {
              lastOutcome = outcome.status;
              lastValidatedEmail = outcome.email || String(input.value || '').trim();
            }
            return;
          }
          if (currentAbortController) {
            currentAbortController.abort();
            currentAbortController = null;
          }
          const button = getSubmitButton();
          setSubmitBlocked(true);
          setFieldStatusIcon(input, documentContext, 'pending', hideResults);
          currentAbortController = new AbortController();
          const signal = currentAbortController.signal;
          const outcome = await zb.validate(input, button, signal);
          if (currentAbortController && currentAbortController.signal === signal) {
            currentAbortController = null;
          }
          if (outcome && outcome.status !== 'aborted') {
            lastOutcome = outcome.status;
            lastValidatedEmail = outcome.email || String(input.value || '').trim();
          }
        };

        const clearTimers = () => {
          if (blurTimer) {
            clearTimeout(blurTimer);
            blurTimer = null;
          }
          if (idleTimer) {
            clearTimeout(idleTimer);
            idleTimer = null;
          }
        };

        const scheduleIdleValidate = () => {
          if (!idleMs) return;
          if (idleTimer) clearTimeout(idleTimer);
          idleTimer = setTimeout(() => {
            idleTimer = null;
            runValidate();
          }, idleMs);
        };

        const blockUncheckedSubmit = (event) => {
          if (!disableSubmit) return;
          if (emailIsAllowedToSubmit()) {
            zbLog('submit allowed');
            return;
          }
          zbLog('submit blocked', { type: event.type });
          event.preventDefault();
          if (typeof event.stopImmediatePropagation === 'function') {
            event.stopImmediatePropagation();
          } else {
            event.stopPropagation();
          }
          setSubmitBlocked(true);
          if (!currentAbortController) runValidate();
        };

        const isSubmitControl = (target) => {
          if (!target || !target.closest) return false;
          return Boolean(target.closest('[type="submit"]'));
        };

        input.addEventListener('focus', function () {
          if (blurTimer) {
            clearTimeout(blurTimer);
            blurTimer = null;
            const email = String(input.value || '').trim();
            if (!email) {
              clearEmptyFieldValidation();
            } else if (lastValidatedEmail === email && lastOutcome) {
              setFieldStatusIcon(
                input,
                documentContext,
                lastOutcome === 'valid' ? 'valid' : lastOutcome === 'invalid' ? 'invalid' : lastOutcome,
                hideResults,
              );
              setSubmitBlocked(lastOutcome === 'invalid');
            } else {
              setFieldStatusIcon(input, documentContext, '', hideResults, '');
              setSubmitBlocked(false);
            }
          }
          scheduleIdleValidate();
        });

        input.addEventListener('blur', function () {
          zbLog('blur', { value: String(input.value || '').trim(), idleOnly: idleOnly });
          if (String(input.value || '').trim() === '') {
            clearTimers();
            if (currentAbortController) {
              currentAbortController.abort();
              currentAbortController = null;
            }
            clearEmptyFieldValidation();
            return;
          }
          // In idle mode leaving the field decides nothing: a pending idle timer
          // is left to fire and a request already in flight is left to finish,
          // so the address is still checked exactly once.
          if (idleOnly) return;
          if (idleTimer) {
            clearTimeout(idleTimer);
            idleTimer = null;
          }
          if (currentAbortController) {
            currentAbortController.abort();
            currentAbortController = null;
          }
          if (!isEmailSyntaxValid(input.value)) {
            runValidate();
            return;
          }
          const email = String(input.value || '').trim();
          if (lastValidatedEmail === email && (lastOutcome === 'valid' || lastOutcome === 'error')) {
            return;
          }
          if (lastValidatedEmail === email && lastOutcome === 'invalid') {
            setSubmitBlocked(true);
            return;
          }
          setSubmitBlocked(true);
          setFieldStatusIcon(input, documentContext, 'pending', hideResults);
          blurTimer = setTimeout(() => {
            blurTimer = null;
            runValidate();
          }, BLUR_VALIDATE_DELAY_MS);
        });

        input.addEventListener('keydown', function (event) {
          if (event.key !== 'Enter' && event.keyCode !== 13) return;
          blockUncheckedSubmit(event);
        });

        const submitRoot = input.closest('form') || getHubSpotFieldHost(input);
        if (submitRoot) {
          const onSubmitIntent = (event) => {
            if (event.type !== 'submit' && !isSubmitControl(event.target)) return;
            blockUncheckedSubmit(event);
          };
          submitRoot.addEventListener('submit', onSubmitIntent, true);
          submitRoot.addEventListener('pointerdown', onSubmitIntent, true);
          submitRoot.addEventListener('mousedown', onSubmitIntent, true);
          submitRoot.addEventListener('click', onSubmitIntent, true);
        }

        let lastKnownValue = input.value;
        const handleValueChange = () => {
          if (input.value === lastKnownValue) return;
          lastKnownValue = input.value;
          if (currentAbortController) {
            currentAbortController.abort();
            currentAbortController = null;
          }
          if (blurTimer) {
            clearTimeout(blurTimer);
            blurTimer = null;
          }
          if (String(input.value || '').trim() === '') {
            clearTimers();
            clearEmptyFieldValidation();
            return;
          }
          scheduleIdleValidate();
        };

        input.addEventListener('input', handleValueChange);
        input.addEventListener('change', handleValueChange);
        typoApplyHandlers.set(input, runValidate);

        // HubSpot sometimes changes value without input/change; poll to stay in sync.
        const pollWindow = documentContext.defaultView || window;
        const valuePoll = pollWindow.setInterval(() => {
          if (!input.isConnected) {
            pollWindow.clearInterval(valuePoll);
            return;
          }
          if (input.value !== lastKnownValue) {
            handleValueChange();
          }
        }, 250);
      });
    }
  }

  root.initializeZeroBounce = initializeZeroBounce;
  root.hubspotFormsV4Validation = requestHubspotFormsValidation;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = requestHubspotFormsValidation;
    module.exports.initializeZeroBounce = initializeZeroBounce;
  }

  // Auto-start when the script tag has data-portal-id (or the embed node does).
  const embedConfig = readEmbedConfig();
  zbLog('auto-start', { portalId: embedConfig.portalId || '(missing)' });
  if (embedConfig.portalId) {
    initializeZeroBounce(embedConfig);
  } else {
    zbLog('auto-start skipped: no portalId on script or HubSpot embed node');
  }
})(typeof window !== 'undefined' ? window : typeof globalThis !== 'undefined' ? globalThis : this);
