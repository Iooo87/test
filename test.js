const initializeZeroBounce = (config) => {
  class ZeroBounceApi {
    constructor(apiKey, disableSubmit, hideResults, documentContext) {
      this.apiKey = apiKey;
      this.disableSubmit = disableSubmit;
      this.hideResults = hideResults;
      this.baseUrl = config.stagingAPI || config.testAPI || 'https://extension-api.zerobounce.net/api';
      this.emailRegex = /^[a-zA-Z0-9._%+=!?/|{}$^~`&#*-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/;
      this.document = documentContext;
    }

    async validate(input, loader, button) {
      const uri = this.baseUrl + '/integration/widgets/validate/';
      const container = loader.parentNode;
      const form = input.closest('form');
      
      // Safety check: if container or form was destroyed during the delay, stop.
      if (!container || !form) return;

      const iconContainer = this.document.createElement('div');
      let validationResultInput = form.querySelector('input[name="zb_validation_result"]');

      if (!validationResultInput) {
        validationResultInput = this.document.createElement('input');
        validationResultInput.type = 'hidden';
        validationResultInput.name = 'zb_validation_result';
        form.appendChild(validationResultInput);
      }

      // Safe removal of loader using parent check
      if (loader && loader.parentNode === container) {
        container.removeChild(loader);
      }

      // Regex check (Pre-validation)
      if (!this.emailRegex.test(input.value)) {
        this.applyResultUI(container, input, iconContainer, 'invalid', button);
        validationResultInput.value = 'invalid';
        return;
      }

      const jsonData = JSON.stringify({ public_key: this.apiKey, email: input.value, widget_type: 'hubspot' });

      try {
        const response = await fetch(uri, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: jsonData,
        });

        const result = await response.json();

        // Safety check: verify container is still in the DOM after fetch
        if (!container.parentNode) return;

        if (response.ok) {
          if (result.valid) {
            this.applyResultUI(container, input, iconContainer, 'valid', button);
            validationResultInput.value = 'valid';
          } else {
            this.applyResultUI(container, input, iconContainer, 'invalid', button);
            validationResultInput.value = 'invalid';
          }
        } else {
          throw new Error(result.error_message || 'API Error');
        }
      } catch (error) {
        console.error('Validation error:', error);
        this.applyResultUI(container, input, iconContainer, 'error', button);
        validationResultInput.value = 'error';
      }
    }

    applyResultUI(container, input, iconContainer, status, button) {
      // 1. Handle the hideResults flag
      if (this.hideResults) {
        container.style.display = 'none';
        // If it's an error/invalid and we block submit, keep button disabled
        if (this.disableSubmit && button) {
          button.disabled = (status === 'invalid');
        }
        return;
      }

      // 2. Clear any existing icons safely
      const existingIcon = container.querySelector('.zb-icon');
      if (existingIcon) existingIcon.remove();

      // 3. Set Styles based on status
      iconContainer.classList.add('zb-icon');
      iconContainer.style.fontSize = '16px';
      iconContainer.style.marginRight = '8px';

      if (status === 'valid') {
        container.style.borderColor = 'rgba(82,168,236,.8)';
        iconContainer.innerHTML = '&#x2713;';
        iconContainer.style.color = '#3cb043';
        iconContainer.style.transform = 'scale(1.5, 1)';
        if (this.disableSubmit && button) button.disabled = false;
      } else if (status === 'invalid') {
        container.style.borderColor = '#DC143C';
        iconContainer.innerHTML = '&#x2718;';
        iconContainer.style.color = '#DC143C';
        input.style.borderColor = '#DC143C';
        if (this.disableSubmit && button) button.disabled = true;
      } else {
        // Status: Error (API Down) - We let them submit so leads aren't lost
        if (this.disableSubmit && button) button.disabled = false;
      }

      container.insertBefore(iconContainer, container.firstChild);
    }
  }

  const disableSubmit = typeof config.disableSubmitOnError !== 'undefined' ? config.disableSubmitOnError : true;
  const hideResults = typeof config.hideResults !== 'undefined' ? config.hideResults : false;
  const selector = config.hubspotFormId.length > 0 ? `[id*='${config.hubspotFormId}'][type='email']` : '';

  // Initialization logic for iframes or inline forms
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

    logo.src = 'https://www.zerobounce.net/cdn-cgi/image/fit=scale-down,format=auto,quality=100,height=23,metadata=none/static/logo.png';

    // Container Styles
    loaderContainer.classList.add('loaderContainer');
    Object.assign(loaderContainer.style, {
      position: 'absolute',
      right: '0',
      borderRadius: '0 0 4px 4px',
      backgroundColor: '#fff',
      boxShadow: '0 2px 2px rgba(0,0,0,.2)',
      display: 'none', // Start hidden
      alignItems: 'baseline',
      padding: '3px 5px 5px',
      height: '32px',
      border: '1px solid #bbbbbb',
      borderTop: 'none',
      zIndex: '1000'
    });

    // Loader Styles
    loader.classList.add('loader');
    Object.assign(loader.style, {
      border: '3px solid',
      borderColor: '#888 #fbdd46 #888 #fbdd46',
      borderRadius: '50%',
      width: '15px',
      height: '15px',
      marginRight: '8px'
    });

    loader.animate([{ transform: 'rotate(0deg)' }, { transform: 'rotate(360deg)' }], {
      duration: 2000,
      iterations: Infinity,
    });

    if (!hideResults) loaderContainer.appendChild(logo);

    inputs.forEach((input) => {
      input.addEventListener('focus', function () {
        input.parentNode.style.position = 'relative';
        if (input.value.length > 0) {
          loaderContainer.style.display = hideResults ? 'none' : 'flex';
          input.style.borderBottomRightRadius = '0';
        }
      });

      input.addEventListener('blur', function () {
        input.style.removeProperty('border-bottom-right-radius');
        loaderContainer.style.display = 'none'; // Hide on blur, but don't remove from DOM
      });

      input.addEventListener('input', function () {
        clearTimeout(delayTimer);
        const me = this;
        const parent = input.parentNode;
        const form = input.closest('form');
        const button = form.querySelector("[type='submit']");

        // Clean UI state
        input.style.cssText = '';
        const existingIcon = loaderContainer.querySelector('.zb-icon');
        if (existingIcon) existingIcon.remove();

        if (disableSubmit && button) button.disabled = true;

        if (me.value.length > 0) {
          if (!parent.querySelector('.loaderContainer')) {
            parent.insertBefore(loaderContainer, input.nextSibling);
          }
          loaderContainer.style.display = hideResults ? 'none' : 'flex';
          input.style.borderBottomRightRadius = '0';
          
          // Re-insert loader for fresh validation
          if (loader.parentNode !== loaderContainer) {
            loaderContainer.insertBefore(loader, loaderContainer.firstChild);
          }

          delayTimer = setTimeout(function () {
            if (me.value !== '') zb.validate(me, loader, button);
          }, 500);
        } else {
          loaderContainer.style.display = 'none';
        }
      });
    });
  }
};
