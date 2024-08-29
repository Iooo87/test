const initializeZeroBounce = (config) => {
  class ZeroBounceApi {
    constructor(apiKey, disableSubmit, iframe) {
      this.apiKey = apiKey;
      this.disableSubmit = disableSubmit;
      this.baseUrl = config.stagingAPI ? config.stagingAPI : config.testAPI ? config.testAPI : 'https://extension-api.zerobounce.net/api';
      this.emailRegex = /^[a-zA-Z0-9._%+=!?/|{}$^~`&#*-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/;
      this.document = iframe;
    }

    async validate(input, loader, button, initBR) {
      const uri = this.baseUrl + '/integration/widgets/validate/';
      const container = loader.parentNode;
      const iconContainer = this.document.createElement('div');

      iconContainer.classList.add('zb-icon');
      iconContainer.style.fontSize = '16px';
      iconContainer.style.marginRight = '8px';

      if (!this.emailRegex.test(input.value)) {
        container.removeChild(loader);
        container.style.borderColor = '#DC143C';
        iconContainer.innerHTML = '&#x2718;';
        iconContainer.style.color = '#DC143C';
        container.insertBefore(iconContainer, container.firstChild);
        return;
      }

      const jsonData = JSON.stringify({ public_key: this.apiKey, email: input.value, widget_type: 'hubspot' });

      try {
        const response = await fetch(uri, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: jsonData,
        });

        const result = await response.json();
        container.removeChild(loader);

        if (response.ok) {
          if (result.valid) {
            container.style.borderColor = 'rgba(82,168,236,.8)';
            iconContainer.innerHTML = '&#x2713;';
            iconContainer.style.color = '#3cb043';
            iconContainer.style.transform = 'scale(1.5, 1)';
            if (this.disableSubmit && button) {
              button.disabled = false;
            }
          } else {
            iconContainer.innerHTML = '&#x2718;';
            iconContainer.style.color = '#DC143C';
            if (this.disableSubmit) {
              input.style.borderColor = '#DC143C';
              container.style.borderColor = '#DC143C';
            }
          }
          container.insertBefore(iconContainer, container.firstChild);
        } else {
          container.style.borderColor = '#DC143C';
          iconContainer.innerHTML = '&#x2718;';
          iconContainer.style.color = '#DC143C';
          container.insertBefore(iconContainer, container.firstChild);
          throw new Error(result.error_message);
        }
      } catch (error) {
        console.error('Validation error:', error);
        iconContainer.innerHTML = '&#x2718;';
        input.style.borderColor = '#DC143C';
        container.style.color = '#DC143C';
        container.style.borderColor = '#DC143C';
        container.insertBefore(iconContainer, container.firstChild);
        if (this.disableSubmit && button) {
          button.disabled = false;
        }
      }
    }
  }

  const disableSubmit = typeof config.disableSubmitOnError !== 'undefined' ? config.disableSubmitOnError : true;
  const iframes = document.querySelectorAll("[id^='hs-form-iframe']");
  const selector =  config.hubspotFormId.length > 0 ? "[id$='" + config.hubspotFormId + "'][type='email']" : '';

  if (selector.length === 0 || iframes.length === 0) return null;

  iframes.forEach((iframe) => {
    const iframeDocument = iframe.contentDocument || iframe.contentWindow.document;
    const zb = new ZeroBounceApi(config.apiKey, disableSubmit, iframeDocument);
    const inputs = iframeDocument.querySelectorAll(selector);
    const loaderContainer = iframeDocument.createElement('div');
    const loader = iframeDocument.createElement('div');
    const logo = iframeDocument.createElement('img');
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

    loader.classList.add('loader');
    loader.style.border = '3px solid';
    loader.style.borderColor = '#888 #fbdd46 #888 #fbdd46';
    loader.style.borderRadius = '50%';
    loader.style.width = '15px';
    loader.style.height = '15px';
    loader.style.marginRight = '8px';

    loader.animate([{ transform: 'rotate(0deg)' }, { transform: 'rotate(360deg)' }], {
      duration: 2000,
      iterations: Infinity,
    });

    loaderContainer.appendChild(logo);

    inputs.forEach((input) => {
      input.addEventListener('focus', function () {
        if (input.value.length > 0) {
          const parent = input.parentNode;
          parent.insertBefore(loaderContainer, input.nextSibling);
        }
      });

      input.addEventListener('blur', function () {
        const parent = input.parentNode;
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
        const inputStyles = window.getComputedStyle(input);
        const initBR = inputStyles.borderRadius;
        loaderContainer.style.borderColor = 'rgba(82,168,236,.8)';

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
          parent.insertBefore(loaderContainer, input.nextSibling);
          input.style.borderRadius = initBR + ' ' + initBR + ' 0 ' + initBR;
        }

        loaderContainer.insertBefore(loader, loaderContainer.firstChild);
        delayTimer = setTimeout(function () {
          if (me.value === '' && parent.querySelectorAll('.loaderContainer').length > 0) {
            parent.removeChild(loaderContainer);
            input.style.cssText = '';
          }
          if (me.value !== '') zb.validate(me, loader, button, initBR);
        }, 500);
      });
    });
  });
};
