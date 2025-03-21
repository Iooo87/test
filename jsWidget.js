(function () {
    const ZBWidget = {
      config: null,

      init: function (config) {
        this.config = JSON.parse(atob(config));
          console.log(this.config);
        this.setupValidation();
      },
      
      createElement: function (tag, className, styles = {}) {
        const element = document.createElement(tag);
        if (className) element.classList.add(className);
        Object.assign(element.style, styles);
        return element;
      },

      setupLoaderComponent: function () {
        const loaderContainer = this.createElement('div', 'loaderContainer', {
          position: 'absolute', right: 0, borderRadius: '0 0 4px 4px', backgroundColor: '#fff',
          boxShadow: '0 2px 2px rgba(0,0,0,.2)', display: 'flex', alignItems: 'center',
          padding: '1px 5px 2px', height: '32px', border: '1px solid #bbbbbb',
          borderTop: 'none', zIndex: '1000'
        });
        const logo = this.createElement('img');
        logo.src = 'https://www.zerobounce.net/cdn-cgi/image/fit=scale-down,format=auto,quality=100,height=20,metadata=none/static/logo.png';
        loaderContainer.appendChild(logo);
        return loaderContainer;
      },
      
      setupSubmitButton: function (input, disabled) {
        const form = input.closest('form');
        const submitButton = form.querySelector("[type='submit']");
        if (submitButton) submitButton.disabled = disabled;
      },

      setupLoaderAnimation: function () {
        const loader = this.createElement('div', 'loader', {
          border: '3px solid', borderColor: '#888 #fbdd46 #888 #fbdd46', borderRadius: '50%',
          width: '14px', height: '14px', pointerEvents: 'none', display: 'none'
        });
        loader.animate([{ transform: 'rotate(0deg)' }, { transform: 'rotate(360deg)' }], {
          duration: 2000, iterations: Infinity
        });
        return loader;
      },

      setupMessageContainer: function () {
        return this.createElement('div', 'zb-message', {
          position: 'absolute', left: '0', background: '#fff', padding: '5px',
          borderRadius: '4px', boxShadow: '0 2px 5px rgba(0, 0, 0, 0.1)', fontSize: '12px',
          display: 'none'
        });
      },

      setupLoaderType: function (input, parent, loaderContainer, loader) {
        loader.style.display = 'block';
        if (this.config.styling === 'custom') {
          loader.style.position = 'absolute';
          loader.style.right = `${input.offsetHeight / 2 - 10}px`;
          loader.style.top = `${input.offsetHeight / 2 - 10}px`;
          parent.append(loader);
        } else {
          loader.style.marginRight = '8px';
          loader.style.marginTop = '5px';
          this.removeExistingIcon(loaderContainer);
          loaderContainer.insertBefore(loader, loaderContainer.firstChild);
          parent.insertBefore(loaderContainer, input.nextSibling);
        }
      },
      
      setupHiddenInput: function (parent, input) {
        if (parent.querySelector("#zbone_valid")) return;
        const hiddenInput = this.createElement('input');
        hiddenInput.type = 'hidden';
        hiddenInput.id = 'zbone_valid';
        parent.insertBefore(hiddenInput, input.nextSibling);
      },

      setupValidation: function () {
        console.info("Setting up email validation...");
        const emailRegex = /^[a-zA-Z0-9._%+=!?/|{}$^~'`&#*-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/;
        const inputs = document.querySelectorAll('.zb-email[type="email"]');

        inputs.forEach((input) => {
          const parent = input.parentNode;
          parent.style.position = 'relative';

          const loader = this.setupLoaderAnimation();
          const loaderContainer = this.setupLoaderComponent();
          input.addEventListener('input', () => {
            clearTimeout(input.validationTimer);
            if (this.config.nonAcceptedStatusBehavior === 'block') {
              let messageContainer = parent.querySelector('.zb-message');
              if (messageContainer) parent.removeChild(messageContainer);
              this.setupSubmitButton(input, true);
              this.setupLoaderType(input, parent, loaderContainer, loader);
            } else {
              this.setupHiddenInput(parent, input);
            }

            input.validationTimer = setTimeout(() => {
              if (emailRegex.test(input.value)) {
                this.validate(input, loader);
              }
            }, 500);
          });

          input.addEventListener('blur', () => {
            if (parent.querySelector('.loaderContainer')) {
              parent.removeChild(loaderContainer);
            }

            let messageContainer = parent.querySelector('.zb-message');
            if (messageContainer) {
              parent.removeChild(messageContainer);
            }

            if (this.config.styling === 'custom') {
              loader.style.display = 'none';
            }
          });
        });
      },

      validate: async function (input, loader) {
        const uri = 'https://test-members-api.zerobounce.net/api/integration/widgets/validate/';
        const jsonData = JSON.stringify({
          public_key: this.config.apiKey, email: input.value, widget_type: 'js_widget'
        });

        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), this.config.timeoutLimit * 1000);

        const response = await fetch(uri, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Referer': this.config.domain
          },
          body: jsonData,
          signal: controller.signal
        });
        const result = await response.json();
        const container = input.parentNode;
        let messageContainer = container.querySelector('.zb-message') || this.setupMessageContainer();
        if (!container.contains(messageContainer)) container.appendChild(messageContainer);

        if (response.ok) {
          if (this.config.nonAcceptedStatusBehavior === 'allow') {
            const hiddenInput = document.getElementById('zbone_valid');
            if (hiddenInput) hiddenInput.value = result.valid;
          } else {
            loader.style.display = 'none';
            if (result.valid) this.setupSubmitButton(input, false);
            if (this.config.styling === "custom") {
              messageContainer.id = this.config.customStyling.htmlId;
              messageContainer.innerHTML = result.valid ? this.config.customStyling.validMessage : this.config.customStyling.invalidMessage;
              messageContainer.style.color = result.valid ? '#3cb043' : '#DC143C';
              messageContainer.style.display = 'block';
            } else {
              this.setupValidInvalidIcon(container, result.valid);
            }
          }
        } else {
          const parent = input.parentNode;
          const loaderContainer = container.querySelector('.loaderContainer');
          const hiddenInput = document.getElementById('zbone_valid');
          parent.removeChild(loaderContainer);
          
          this.setupSubmitButton(input, false);
          this.setupHiddenInput(input.parentNode, input);
          
          if (hiddenInput) hiddenInput.value = JSON.stringify(result);
        }

      },

      removeExistingIcon: function (loaderContainer) {
        if (!loaderContainer) return;

        const existingIcon = loaderContainer.querySelector('.zb-icon');
        if (existingIcon) loaderContainer.removeChild(existingIcon);

      },

      setupValidInvalidIcon: function (container, isValid) {
        const loaderContainer = container.querySelector('.loaderContainer');
        if (!loaderContainer) return;

        const existingLoader = loaderContainer.querySelector('.loader');
        if (existingLoader) loaderContainer.removeChild(existingLoader);

        this.removeExistingIcon(loaderContainer);

        const icon = this.createElement('div', 'zb-icon', {
          fontSize: '16px', marginRight: '8px', transform: 'scale(1.5, 1)',
          marginTop: '4px', color: isValid ? '#3cb043' : '#DC143C'
        });
        icon.innerHTML = isValid ? '&#x2713;' : '&#x2718;';

        loaderContainer.insertBefore(icon, loaderContainer.firstChild);
      }
    };

    window.ZBWidget = ZBWidget;
})();
