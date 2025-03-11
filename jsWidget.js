const ZeroBounce_JsWidget_APIKEY = '';
const disableSubmitOnError = true;

class ZeroBounceApi {
  constructor(apiKey, disableSubmit) {
    this.apiKey = apiKey;
    this.disableSubmit = disableSubmit;
    this.baseUrl = 'https://extension-api.zerobounce.net';
    this.emailRegex = /^[a-zA-Z0-9._%+=!?/|{}$^~'`&#*-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/;
  }

  validate(input, loader, button, initBR) {
    const xhr = new XMLHttpRequest();
    const uri = this.baseUrl + '/api/integration/widgets/validate/';
    const container = loader.parentNode;
    const iconContainer = document.createElement('div');

    iconContainer.classList.add('zb-icon');
    iconContainer.style.fontSize = '16px';
    iconContainer.style.marginRight = '8px';

    if (!this.emailRegex.test(input.value)) {
      container.removeChild(loader);
      iconContainer.innerHTML = '&#x2718;';
      iconContainer.style.color = '#DC143C';
      container.insertBefore(iconContainer, container.firstChild);
      return;
    }

    const jsonData = JSON.stringify({ public_key: this.apiKey, email: input.value, widget_type: 'js_widget' });

    xhr.open('POST', uri, false);
    xhr.setRequestHeader('Content-Type', 'application/json');

    xhr.send(jsonData);
    container.removeChild(loader);
    const response = JSON.parse(xhr.response);
    if (xhr.readyState == 4 && xhr.status == 200) {
      if (response.valid) {
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
      if (response.error_message !== 'Account ran out of credits' || response.error_message !== 'Rate limit exceeded') {
        input.style.borderRadius = initBR;
        container.remove();
        if (this.disableSubmit && button) {
          button.disabled = false;
        }
      } else {
        iconContainer.innerHTML = '&#x2718;';
        iconContainer.style.color = '#DC143C';
        input.style.borderColor = '#DC143C';
        container.style.borderColor = '#DC143C';
        container.insertBefore(iconContainer, container.firstChild);
      }
    }
  }
}

const disableSubmit = typeof disableSubmitOnError !== 'undefined' ? disableSubmitOnError : true;
const zb = new ZeroBounceApi(ZeroBounce_JsWidget_APIKEY, disableSubmit);

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
    }, 1000);
  });
});
