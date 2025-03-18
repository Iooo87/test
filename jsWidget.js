(function () {
    var ZBWidget = {
        config: null,

        init: function (config) {
            this.config = JSON.parse(atob(config));
            console.log("Initializing ZBWidget with config:", this.config);
            this.setupValidation();
        },

        setupValidation: function () {
            console.log("Setting up email validation...");
            const inputs = document.querySelectorAll('.zb-email[type="email"]');
            let delayTimer;

            inputs.forEach((input) => {
                const parent = input.parentNode;

                if (ZBWidget.config.nonAcceptedStatusBehavior === "allow") {
                    const hiddenInput = document.createElement('input');
                    hiddenInput.type = 'hidden';
                    hiddenInput.id = 'zbone_valid';
                    parent.insertBefore(hiddenInput, input.nextSibling);
                } else {
                    const loader = document.createElement('div');
                    loader.classList.add('loader');
                    loader.style.border = '3px solid';
                    loader.style.borderColor = '#888 #fbdd46 #888 #fbdd46';
                    loader.style.borderRadius = '50%';
                    loader.style.width = '10px';
                    loader.style.height = '10px';
                    loader.style.marginLeft = '5px';
                    loader.animate([{ transform: 'rotate(0deg)' }, { transform: 'rotate(360deg)' }], {
                        duration: 2000,
                        iterations: Infinity,
                    });

                    input.addEventListener('focus', function () {
                        parent.appendChild(loader);
                    });

                    input.addEventListener('blur', function () {
                        if (parent.contains(loader)) {
                            parent.removeChild(loader);
                        }
                    });

                    input.addEventListener('input', function () {
                        clearTimeout(delayTimer);
                        const form = input.closest('form');
                        const button = form.querySelector("[type='submit']");
                        input.style.cssText = '';

                        if (ZBWidget.config.disableSubmit && button) button.disabled = true;

                        if (input.value !== '') {
                            ZBWidget.validate(input, loader, button);
                        }
                    });
                }
            });
        },

        validate: function (input, loader, button) {
            const xhr = new XMLHttpRequest();
            const uri = 'https://extension-api.zerobounce.net/api/integration/widgets/validate/';
            const container = input.parentNode;
            let messageContainer = container.querySelector('.zb-message');

            if (!messageContainer) {
                messageContainer = document.createElement('div');
                messageContainer.classList.add('zb-message');
                messageContainer.style.marginTop = '5px';
                messageContainer.style.fontSize = '12px';
                container.appendChild(messageContainer);
            }

            const emailRegex = /^[a-zA-Z0-9._%+=!?/|{}$^~'`&#*-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/;

            if (!emailRegex.test(input.value)) {
                messageContainer.innerHTML = ZBWidget.config.styling === "custom" ? ZBWidget.config.customStyling.invalidMessage : 'Invalid email format';
                messageContainer.style.color = '#DC143C';
                return;
            }

            const jsonData = JSON.stringify({
                public_key: ZBWidget.config.apiKey,
                email: input.value,
                widget_type: 'js_widget'
            });

            xhr.open('POST', uri, false);
            xhr.setRequestHeader('Content-Type', 'application/json');
            xhr.send(jsonData);

            const response = JSON.parse(xhr.response);
            if (xhr.readyState === 4 && xhr.status === 200) {
                messageContainer.innerHTML = response.valid
                    ? (ZBWidget.config.styling === "custom" ? ZBWidget.config.customStyling.validMessage : 'Valid email')
                    : (ZBWidget.config.styling === "custom" ? ZBWidget.config.customStyling.invalidMessage : 'Invalid email');
                messageContainer.style.color = response.valid ? '#3cb043' : '#DC143C';
                if (ZBWidget.config.disableSubmit && button) {
                    button.disabled = !response.valid;
                }
            }
        }
    };

    window.ZBWidget = ZBWidget;
})();
