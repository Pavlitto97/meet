document.addEventListener('DOMContentLoaded', function () {
  const micButton = document.getElementById('micButton');
  const cameraButton = document.getElementById('cameraButton');
  const leaveButton = document.getElementById('leaveButton');
  const copyButton = document.getElementById('copyButton');

  micButton.addEventListener('click', function () {
    const state = micButton.getAttribute('data-state');
    if (state === 'off') {
      micButton.setAttribute('data-state', 'on');
      micButton.innerHTML = '<span class="icon">🎙️</span> Мікрофон увімкнено';
    } else {
      micButton.setAttribute('data-state', 'off');
      micButton.innerHTML = '<span class="icon">🎙️</span> Увімкнути мікрофон';
    }
  });

  cameraButton.addEventListener('click', function () {
    const state = cameraButton.getAttribute('data-state');
    if (state === 'on') {
      cameraButton.setAttribute('data-state', 'off');
      cameraButton.innerHTML = '<span class="icon">📷</span> Увімкнути камеру';
    } else {
      cameraButton.setAttribute('data-state', 'on');
      cameraButton.innerHTML = '<span class="icon">📷</span> Вимкнути камеру';
    }
  });

  leaveButton.addEventListener('click', function () {
    leaveButton.textContent = 'Ви вийшли з дзвінка';
    leaveButton.disabled = true;
    leaveButton.style.cursor = 'default';
  });

  copyButton.addEventListener('click', function () {
    navigator.clipboard.writeText('yrt-kczi-csw').then(() => {
      copyButton.textContent = 'Скопійовано!';
      setTimeout(() => {
        copyButton.textContent = 'Копіювати';
      }, 1600);
    });
  });
});
