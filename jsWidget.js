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
            
            inputs.forEach((input) => {
                const parent = input.parentNode;
                parent.style.position = 'relative';
                
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
                    loader.style.width = '14px';
                    loader.style.height = '14px';
                    loader.style.position = 'absolute';
                    loader.style.pointerEvents = 'none';
                    loader.style.display = 'none';
                    loader.animate([{ transform: 'rotate(0deg)' }, { transform: 'rotate(360deg)' }], {
                        duration: 2000,
                        iterations: Infinity,
                    });
                    
                    if (ZBWidget.config.styling === "custom") {
                        input.style.paddingRight = '25px';
                        parent.appendChild(loader);
                        
                        const inputHeight = input.offsetHeight;
                        loader.style.top = `${inputHeight / 2 - 7}px`;
                        loader.style.right = `10px`;
                    }

                    input.addEventListener('focus', function () {
                        loader.style.display = 'block';
                    });

                    input.addEventListener('blur', function () {
                        loader.style.display = 'none';
                    });

                    input.addEventListener('input', function () {
                        const form = input.closest('form');
                        const button = form.querySelector("[type='submit']");
                        
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
                messageContainer.style.position = 'absolute';
                messageContainer.style.left = '0';
                messageContainer.style.background = '#fff';
                messageContainer.style.padding = '5px';
                messageContainer.style.borderRadius = '4px';
                messageContainer.style.boxShadow = '0 2px 5px rgba(0, 0, 0, 0.1)';
                messageContainer.style.fontSize = '12px';
                messageContainer.style.display = 'none';
                container.appendChild(messageContainer);
            }

            const emailRegex = /^[a-zA-Z0-9._%+=!?/|{}$^~'`&#*-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/;
            
            setTimeout(() => {
                loader.style.display = 'none';
                
                if (!emailRegex.test(input.value)) {
                    messageContainer.innerHTML = ZBWidget.config.styling === "custom" ? ZBWidget.config.customStyling.invalidMessage : 'Invalid email format';
                    messageContainer.style.color = '#DC143C';
                    messageContainer.style.display = 'block';
                    parent.style.paddingBottom = `${messageContainer.offsetHeight + 5}px`;
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
                    messageContainer.style.display = 'block';
                    parent.style.paddingBottom = `${messageContainer.offsetHeight + 5}px`;
                    if (ZBWidget.config.disableSubmit && button) {
                        button.disabled = !response.valid;
                    }
                }
            }, 500);
        }
    };

    window.ZBWidget = ZBWidget;
})();
