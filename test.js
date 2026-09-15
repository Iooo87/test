/**
 * ZeroBounce HubSpot Forms v4 email validation widget.
 *
 * Embed next to a HubSpot developer/HTML form (`.hs-form-html`):
 *
 *   <script src=".../hubspot-forms-v4-validation.min.js"
 *     data-portal-id="YOUR_PORTAL_ID"
 *     data-form-id="YOUR_FORM_GUID"
 *     defer></script>
 *
 * Or: window.initializeZeroBounce({ portalId, hubspotFormId, ... })
 *
 * How it runs:
 *   Finds email inputs, then validates 350ms after blur — or, when
 *   idleSeconds is set, only after that idle pause.
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
        ? document.querySelector('.hs-form-html[data-portal-id], .hs-form-frame[data-portal-id]')
        : null;
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
  const getIframeDocument = (iframe) => {
    try {
      return iframe.contentDocument || iframe.contentWindow.document;
    } catch (e) {
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
    return inputs;
  };

  /**
   * Public entry: merge script-tag + JS config, bind the form.
   * Optional config.email runs one API call (syntax-checked) and returns the payload.
   */
  const initializeZeroBounce = async (configOrPortalId, maybeEmail) => {
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
      return;
    }


    if (typeof document !== 'undefined') {
      bindHubspotFormValidation(config);
    }

    if (config.email) {
      if (!isEmailSyntaxValid(config.email)) {
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
        const host = getHubSpotFieldHost(input);
        const documentContext = this.document;
        if (!host) {
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

          return { status: isValid ? 'valid' : 'invalid', email: email, result: result };
        } catch (error) {
          if (error.name === 'AbortError') {
            return { status: 'aborted' };
          }
          console.error('Validation error:', error);
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
     * their form DOM changes.
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
          return;
        }
        if (watchedIframeDocuments.has(iframeDocument)) return;


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
      watchAccessibleHubSpotIframes();
      const found = collectHubSpotEmailInputs(document, hubspotFormId);
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
    };

    attachToFoundInputs();

    root.addEventListener('hs-form-event:on-ready', () => {
      attachToFoundInputs();
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
      unbound.forEach((input) => boundEmailInputs.add(input));
      if (!unbound.length) {
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
            return;
          }
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
        });

        input.addEventListener('blur', function () {
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
  if (embedConfig.portalId) {
    initializeZeroBounce(embedConfig);
  }
})(typeof window !== 'undefined' ? window : typeof globalThis !== 'undefined' ? globalThis : this);
