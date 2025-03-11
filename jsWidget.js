(function () {
    var ZBWidget = {
        config: null, // Store config

        init: function (config) {
            this.config = atob(config);
            // console.log("Initializing ZBWidget with config:", this.config);
            this.setupValidation();
        },

        setupValidation: function () {
            console.log("Setting up email validation...");
            const inputs = document.querySelectorAll('.zb-email[type="email"]');
            const loaderContainer = document.createElement('div');
            const loader = document.createElement('div');
            const logo = document.createElement('img');
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
            loaderContainer.style.height = '27px';
            loaderContainer.style.border = '1px solid #bbbbbb';
            loaderContainer.style.borderTop = 'none';
            loaderContainer.style.zIndex = '1000';

            loader.classList.add('loader');
            loader.style.border = '3px solid';
            loader.style.borderColor = '#888 #fbdd46 #888 #fbdd46';
            loader.style.borderRadius = '50%';
            loader.style.width = '10px';
            loader.style.height = '10px';
            loader.style.marginRight = '8px';

            loader.animate([{ transform: 'rotate(0deg)' }, { transform: 'rotate(360deg)' }], {
                duration: 2000,
                iterations: Infinity,
            });

            loaderContainer.appendChild(logo);

            inputs.forEach((input) => {
                input.addEventListener('focus', function () {
                    const parent = input.parentNode;
                    parent.insertBefore(loaderContainer, input.nextSibling);
                });

                input.addEventListener('blur', function () {
                    const parent = input.parentNode;
                    if (parent.querySelector('.loaderContainer')) {
                        parent.removeChild(loaderContainer);
                    }
                });

                input.addEventListener('input', function (evt) {
                    clearTimeout(delayTimer);
                    const me = this;
                    const parent = input.parentNode;
                    const form = input.closest('form');
                    const button = form.querySelector("[type='submit']");
                    input.style.cssText = '';
                    const inputStyles = window.getComputedStyle(input);
                    const initBR = inputStyles.borderRadius;
                    loaderContainer.style.borderColor = inputStyles.borderColor;

                    if (input.classList.contains('zb-custom-error')) input.classList.remove('zb-custom-error');
                    if (loaderContainer.classList.contains('zb-custom-error')) input.classList.remove('zb-custom-error');

                    if (ZBWidget.config.disableSubmit && button) button.disabled = true;
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
                    }, 1000);
                });
            });
        }
    };
    window.ZBWidget = ZBWidget;
})();
