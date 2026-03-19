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

    async validate(input, loader, button) {
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

      if (!this.emailRegex.test(input.value)) {
        safeRemove(loader, container);

        if (this.hideResults && container.classList.contains('loaderContainer')) {
          container.style.visibility = 'hidden';
        }
        if (!this.hideResults) {
          container.style.borderColor = '#DC143C';
          iconContainer.innerHTML = '&#x2718;';
          iconContainer.style.color = '#DC143C';
          container.insertBefore(iconContainer, container.firstChild);
        }
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

        if (!container.parentNode) return;

        safeRemove(loader, container);

        if (this.hideResults && container.classList.contains('loaderContainer')) {
          container.style.visibility = 'hidden';
        }

        if (response.ok) {
          if (result.valid) {
            if (!this.hideResults) {
              container.style.borderColor = 'rgba(82,168,236,.8)';
              iconContainer.innerHTML = '&#x2713;';
              iconContainer.style.color = '#3cb043';
              iconContainer.style.transform = 'scale(1.5, 1)';
            }
            if (this.disableSubmit && button) button.disabled = false;
            validationResultInput.value = 'valid';
          } else {
            if (!this.hideResults) {
              iconContainer.innerHTML = '&#x2718;';
              iconContainer.style.color = '#DC143C';
              input.style.borderColor = '#DC143C';
              container.style.borderColor = '#DC143C';
            }
            if (this.disableSubmit && button) button.disabled = true;
            validationResultInput.value = 'invalid';
          }
          if (!this.hideResults) container.insertBefore(iconContainer, container.firstChild);
        } else {
          throw new Error(result.error_message || 'API Error');
        }
      } catch (error) {
        console.error('Validation error:', error);
        safeRemove(loader, container);

        if (this.hideResults && container.classList.contains('loaderContainer')) {
          container.style.visibility = 'hidden';
        }
        if (!this.hideResults && container.parentNode) {
          iconContainer.innerHTML = '&#x2718;';
          input.style.borderColor = '#DC143C';
          container.style.color = '#DC143C';
          container.style.borderColor = '#DC143C';
          container.insertBefore(iconContainer, container.firstChild);
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

    logo.src = 'https://www.zerobounce.net/cdn-cgi/image/fit=scale-down,format=auto,quality=100,height=23,metadata=none/static/logo.png';

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

    inputs.forEach((input) => {
      loaderContainer.style.right = 'calc(100% - ' + input.offsetWidth + 'px)';

      input.addEventListener('focus', function () {
        const parent = input.parentNode;
        parent.style.position = 'relative';
      });

      input.addEventListener('blur', function () {
        const parent = input.parentNode;
        input.style.removeProperty('border-bottom-right-radius');
        if (parent.querySelector('.loaderContainer')) {
          parent.removeChild(loaderContainer);
        }
      });

      input.addEventListener('input', function () {
        clearTimeout(delayTimer);
        const me = this;
        const parent = input.parentNode;
        const form = input.closest('form');
        const button = form.querySelector("[type='submit']");
        input.style.cssText = '';
        if (!hideResults) {
          loaderContainer.style.borderColor = 'rgba(82,168,236,.8)';
        }

        if (input.classList.contains('zb-custom-error')) input.classList.remove('zb-custom-error');
        if (loaderContainer.classList.contains('zb-custom-error')) input.classList.remove('zb-custom-error');

        if (disableSubmit && button) {
          button.disabled = true;
        }
        if (loaderContainer.querySelectorAll('.zb-icon').length > 0) {
          const icon = parent.querySelector('.zb-icon');
          loaderContainer.removeChild(icon);
        }
        if (me.value.length > 0) {
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
          if (me.value === '' && parent.querySelectorAll('.loaderContainer').length > 0) {
            parent.removeChild(loaderContainer);
            if (!hideResults) {
              input.style.cssText = '';
            }
          }
          if (me.value !== '') zb.validate(me, loader, button);
        }, 500);
      });
    });
  }
};
