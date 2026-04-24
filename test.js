(function() {
  if (typeof window.initializeZeroBounce !== 'undefined') return;

  const initializeZeroBounce = (config) => {
  class ZeroBounceApi {
    constructor(apiKey, disableSubmit, hideResults, documentContext) {
      this.apiKey = apiKey;
      this.disableSubmit = disableSubmit;
      this.hideResults = hideResults;
      this.baseUrl = config.stagingAPI ? config.stagingAPI : config.testAPI ? config.testAPI : 'https://extension-api.zerobounce.net/api';
      this.emailRegex = /^[a-zA-Z0-9._%+=!?/|{}$^~`&#*-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/;
      this.document = documentContext;
    }

    async validate(input, loader, button, signal) {
      const uri = this.baseUrl + '/integration/widgets/validate/';
      const container = loader.parentNode;
      const form = input.closest('form');
      const documentContext = this.document;

      if (!container) return;

      const iconContainer = documentContext.createElement('div');
      let validationResultInput = form.querySelector('input[name="zb_validation_result"]');

      if (!validationResultInput) {
        validationResultInput = documentContext.createElement('input');
        validationResultInput.type = 'hidden';
        validationResultInput.name = 'zb_validation_result';
        form.appendChild(validationResultInput);
      }

      iconContainer.classList.add('zb-icon');
      iconContainer.style.fontSize = '16px';
      iconContainer.style.marginRight = '8px';

      const safeRemove = (el, parent) => {
        if (el && el.parentNode === parent) {
          parent.removeChild(el);
        }
      };

      const clearResultIcons = (parent) => {
        if (!parent) return;
        parent.querySelectorAll('.zb-icon').forEach((node) => {
          if (node.parentNode === parent) parent.removeChild(node);
        });
      };

      if (!this.emailRegex.test(input.value)) {
        safeRemove(loader, container);

        if (this.hideResults && container.classList.contains('loaderContainer')) {
          container.style.visibility = 'hidden';
        }

        // validate() only runs after the input debounce (idle), so this is “stopped typing”, not mid-keystroke.
        if (!this.hideResults) {
          clearResultIcons(container);
          container.style.borderColor = '#DC143C';
          input.style.borderColor = '#DC143C';
          iconContainer.innerHTML = '&#x2718;';
          iconContainer.style.color = '#DC143C';
          container.insertBefore(iconContainer, container.firstChild);
        }
        if (this.disableSubmit && button) button.disabled = true;
        validationResultInput.value = 'invalid';
        return;
      }

      const jsonData = JSON.stringify({ public_key: this.apiKey, email: input.value, widget_type: 'hubspot' });

      try {
        const response = await fetch(uri, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: jsonData,
          signal: signal,
        });

        const result = await response.json();

        if (!response.ok) {
          throw new Error(result.error_message || 'API Error');
        }

        const isValid = Boolean(result.valid);
        const isContainerMounted = Boolean(container.parentNode);

        if (this.disableSubmit && button) button.disabled = !isValid;
        validationResultInput.value = isValid ? 'valid' : 'invalid';

        if (!this.hideResults) {
          if (isValid) {
            input.style.removeProperty('border-color');
          } else {
            input.style.borderColor = '#DC143C';
          }
        }

        safeRemove(loader, container);
        if (this.hideResults && container.classList.contains('loaderContainer')) {
          container.style.visibility = 'hidden';
        }

        if (!isContainerMounted) return;

        if (!this.hideResults) {
          clearResultIcons(container);
          if (isValid) {
            input.style.removeProperty('border-color');
            container.style.borderColor = 'rgba(82,168,236,.8)';
            iconContainer.innerHTML = '&#x2713;';
            iconContainer.style.color = '#3cb043';
            iconContainer.style.transform = 'scale(1.5, 1)';
          } else {
            iconContainer.innerHTML = '&#x2718;';
            iconContainer.style.color = '#DC143C';
            input.style.borderColor = '#DC143C';
            container.style.borderColor = '#DC143C';
          }
          container.insertBefore(iconContainer, container.firstChild);
        }
      } catch (error) {
        if (error.name === 'AbortError') {
          return;
        }
        console.error('Validation error:', error);
        safeRemove(loader, container);

        if (this.hideResults && container.classList.contains('loaderContainer')) {
          container.style.visibility = 'hidden';
        }
        if (!this.hideResults) {
          if (container.parentNode) {
            clearResultIcons(container);
            iconContainer.innerHTML = '&#x2718;';
            container.style.color = '#DC143C';
            container.style.borderColor = '#DC143C';
            container.insertBefore(iconContainer, container.firstChild);
          }
          input.style.borderColor = '#DC143C';
        }
        if (this.disableSubmit && button) button.disabled = false;
        validationResultInput.value = 'error';
      }
    }
  }

  const disableSubmit = typeof config.disableSubmitOnError !== 'undefined' ? config.disableSubmitOnError : true;
  const hideResults = typeof config.hideResults !== 'undefined' ? config.hideResults : false;
  const selector = config.hubspotFormId.length > 0 ? `[id*='${config.hubspotFormId}'][type='email']` : '';

  const iframes = document.querySelectorAll("[id^='hs-form-iframe']");

  if (iframes.length > 0) {
    iframes.forEach((iframe) => {
      const iframeDocument = iframe.contentDocument || iframe.contentWindow.document;
      processValidation(iframeDocument, selector, disableSubmit, hideResults, config.apiKey);
    });
  } else {
    const form = document.querySelector('form[id^="hsForm_"]');
    if (form) {
      processValidation(document, selector, disableSubmit, hideResults, config.apiKey);
    }
  }

  function processValidation(documentContext, selector, disableSubmit, hideResults, apiKey) {
    const zb = new ZeroBounceApi(apiKey, disableSubmit, hideResults, documentContext);
    const inputs = documentContext.querySelectorAll(selector);
    const loaderContainer = documentContext.createElement('div');
    const loader = documentContext.createElement('div');
    const logo = documentContext.createElement('img');
    let delayTimer;
    let currentAbortController = null;

    logo.src = 'https://www.zerobounce.net/cdn-cgi/image/fit=scale-down,format=auto,quality=100,height=23,metadata=none/logo.webp';

    loaderContainer.classList.add('loaderContainer');
    loaderContainer.style.position = 'absolute';
    loaderContainer.style.right = 0;
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

    loader.classList.add('loader');
    loader.style.border = '3px solid';
    loader.style.borderColor = '#888 #fbdd46 #888 #fbdd46';
    loader.style.borderRadius = '50%';
    loader.style.width = '15px';
    loader.style.height = '15px';
    loader.style.marginRight = '8px';

    if (hideResults) {
      loader.style.marginRight = '0';
    }

    loader.animate([{ transform: 'rotate(0deg)' }, { transform: 'rotate(360deg)' }], {
      duration: 2000,
      iterations: Infinity,
    });

    if (!hideResults) {
      loaderContainer.appendChild(logo);
    }

    const restoreResultOnFocus = (input) => {
      if (hideResults || !input.value) return;

      const form = input.closest('form');
      if (!form) return;

      const validationResultInput = form.querySelector('input[name="zb_validation_result"]');
      const status = validationResultInput ? validationResultInput.value : '';

      if (!status || status === 'pending') return;

      if (loader.parentNode === loaderContainer) {
        loaderContainer.removeChild(loader);
      }

      loaderContainer.querySelectorAll('.zb-icon').forEach((node) => {
        if (node.parentNode === loaderContainer) loaderContainer.removeChild(node);
      });

      const icon = documentContext.createElement('div');
      icon.classList.add('zb-icon');
      icon.style.fontSize = '16px';
      icon.style.marginRight = '8px';

      if (status === 'valid') {
        loaderContainer.style.borderColor = 'rgba(82,168,236,.8)';
        icon.innerHTML = '&#x2713;';
        icon.style.color = '#3cb043';
        icon.style.transform = 'scale(1.5, 1)';
      } else if (status === 'invalid' || status === 'error') {
        input.style.borderColor = '#DC143C';
        loaderContainer.style.borderColor = '#DC143C';
        icon.innerHTML = '&#x2718;';
        icon.style.color = '#DC143C';
      } else {
        return;
      }

      loaderContainer.insertBefore(icon, loaderContainer.firstChild);
    };

    inputs.forEach((input) => {
      loaderContainer.style.right = 'calc(100% - ' + input.offsetWidth + 'px)';

      input.addEventListener('focus', function () {
        const parent = input.parentNode;
        parent.style.position = 'relative';

        if (!hideResults && input.value.length > 0 && !parent.querySelector('.loaderContainer')) {
          parent.insertBefore(loaderContainer, input.nextSibling);
          input.style.borderBottomRightRadius = 0;
        }
        restoreResultOnFocus(input);
      });

      input.addEventListener('blur', function () {
        const parent = input.parentNode;
        input.style.removeProperty('border-bottom-right-radius');
        if (parent.querySelector('.loaderContainer')) {
          parent.removeChild(loaderContainer);
        }
      });

      const triggerValidation = () => {
        console.log('here');
        clearTimeout(delayTimer);
        if (currentAbortController) {
          currentAbortController.abort();
          currentAbortController = null;
        }
        const parent = input.parentNode;
        const form = input.closest('form');
        const button = form ? form.querySelector("[type='submit']") : null;
        input.style.cssText = '';
        if (!hideResults) {
          loaderContainer.style.borderColor = 'rgba(82,168,236,.8)';
        }

        if (input.classList.contains('zb-custom-error')) input.classList.remove('zb-custom-error');
        if (loaderContainer.classList.contains('zb-custom-error')) loaderContainer.classList.remove('zb-custom-error');

        if (disableSubmit && button) {
          button.disabled = true;
        }
        if (loaderContainer) {
          const icon = loaderContainer.querySelector('.zb-icon');
          if (icon && icon.parentNode === loaderContainer) {
            loaderContainer.removeChild(icon);
          }
        }
        if (input.value.length > 0) {
          if (!parent.querySelector('.loaderContainer')) {
            parent.insertBefore(loaderContainer, input.nextSibling);
          }
          if (hideResults) {
            loaderContainer.style.visibility = 'visible';
          }
          input.style.borderBottomRightRadius = 0;
        }

        loaderContainer.insertBefore(loader, loaderContainer.firstChild);
        delayTimer = setTimeout(function () {
          if (input.value === '' && parent.querySelectorAll('.loaderContainer').length > 0) {
            parent.removeChild(loaderContainer);
            if (!hideResults) {
              input.style.cssText = '';
            }
          }
          if (input.value !== '') {
            currentAbortController = new AbortController();
            zb.validate(input, loader, button, currentAbortController.signal);
          }
        }, 500);
      };

      // HubSpot's native "Did you mean" typo suggestion sets input.value programmatically
      // and typically fires a 'change' event (not always 'input'), so we listen to both.
      let lastKnownValue = input.value;
      const handleValueChange = () => {
        lastKnownValue = input.value;
        triggerValidation();
      };
      input.addEventListener('input', handleValueChange);
      input.addEventListener('change', handleValueChange);

      // Fallback: in case HubSpot updates the value without dispatching an event
      // (e.g. .value = 'x'), poll briefly after blur since the "Did you mean" link
      // is usually clicked after the input loses focus.
      input.addEventListener('blur', () => {
        let checks = 0;
        const poll = setInterval(() => {
          if (input.value !== lastKnownValue) {
            lastKnownValue = input.value;
            triggerValidation();
          }
          if (++checks >= 10) clearInterval(poll);
        }, 100);
      });
    });
  }
  };

  window.initializeZeroBounce = initializeZeroBounce;
})();
