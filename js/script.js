/**
 * 浅忆图床上传页面
 * 游客上传接口：Lsky Pro POST /api/v1/upload
 */
const UPLOAD_ENDPOINT = 'https://img.shallowrecall.top/api/v1/upload';
const MAX_CONCURRENT_UPLOADS = 2;

const droppable = document.querySelector('.droppable');
const list = document.querySelector('.list');
const ball = document.querySelector('.ball');
const hand = document.querySelector('.hand');
const input = document.getElementById('_ef');

const uploadQueue = [];
const uploadControllers = new Map();
let activeUploads = 0;
let dragDepth = 0;

const formatBytes = (bytes, decimals = 2) => {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const dm = Math.max(0, decimals);
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB', 'PB'];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(k)), sizes.length - 1);
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(dm))} ${sizes[i]}`;
};

const showToast = (message, type = 'success') => {
  const toast = document.createElement('div');
  toast.className = `toast${type === 'error' ? ' is-error' : ''}`;
  toast.textContent = message;
  document.body.appendChild(toast);
  requestAnimationFrame(() => toast.classList.add('is-visible'));
  setTimeout(() => {
    toast.classList.remove('is-visible');
    setTimeout(() => toast.remove(), 220);
  }, 2600);
};

const copyText = async (text) => {
  if (navigator.clipboard && window.isSecureContext) {
    await navigator.clipboard.writeText(text);
    return;
  }
  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.style.position = 'fixed';
  textarea.style.opacity = '0';
  document.body.appendChild(textarea);
  textarea.select();
  const copied = document.execCommand('copy');
  textarea.remove();
  if (!copied) throw new Error('浏览器不支持自动复制');
};

const copyToClipboard = async (button) => {
  const url = button.dataset.url;
  if (!url) return;
  try {
    await copyText(url);
    showToast('图片链接已复制');
  } catch (error) {
    showToast(error.message || '复制失败，请手动复制', 'error');
  }
};

const dragTimeline = gsap.timeline({ paused: true });
dragTimeline
  .to(ball, { duration: 0.4, translateX: '286px', autoAlpha: 1, translateY: '-230px' }, 'drag')
  .to(hand, {
    duration: 0.4,
    transformOrigin: 'right',
    rotate: '66deg',
    translateY: '70px',
    translateX: '-20px',
  }, 'drag');

const setDragState = (active) => {
  droppable.classList.toggle('is-over', active);
  active ? dragTimeline.play() : dragTimeline.reverse();
};

document.addEventListener('dragover', (event) => event.preventDefault());
document.addEventListener('drop', (event) => {
  event.preventDefault();
  dragDepth = 0;
  setDragState(false);
});

list.addEventListener('dragover', (event) => event.preventDefault());
list.addEventListener('dragenter', (event) => {
  event.preventDefault();
  dragDepth += 1;
  setDragState(true);
});
list.addEventListener('dragleave', (event) => {
  event.preventDefault();
  dragDepth = Math.max(0, dragDepth - 1);
  if (dragDepth === 0) setDragState(false);
});
list.addEventListener('drop', (event) => {
  event.preventDefault();
  dragDepth = 0;
  setDragState(false);
  handleFiles(Array.from(event.dataTransfer.files), event.offsetX, event.offsetY);
});

const removeItem = (item) => {
  const controller = uploadControllers.get(item.id);
  if (controller) controller.abort();
  uploadControllers.delete(item.id);

  const queuedIndex = uploadQueue.findIndex((task) => task.item === item);
  if (queuedIndex !== -1) uploadQueue.splice(queuedIndex, 1);

  if (item.previewUrl) URL.revokeObjectURL(item.previewUrl);
  const children = item.querySelectorAll(':scope > *');
  const timeline = gsap.timeline({
    onComplete: () => {
      item.remove();
      if (!document.querySelector('.item')) dragTimeline.reverse();
    },
  });
  timeline
    .to(children, { autoAlpha: 0, y: -10, duration: 0.2, stagger: 0.08 })
    .to(item, { height: 0, paddingTop: 0, paddingBottom: 0, duration: 0.45 }, '-=.15');
};

const runUpload = async ({ file, item, controller }) => {
  const status = item.querySelector('.item-size');
  status.textContent = `上传中 · ${formatBytes(file.size)}`;

  try {
    const formData = new FormData();
    formData.append('file', file, file.name);

    const response = await fetch(UPLOAD_ENDPOINT, {
      method: 'POST',
      body: formData,
      headers: { Accept: 'application/json' },
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
      signal: controller.signal,
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok || !payload?.status) {
      throw new Error(payload?.message || `上传失败（HTTP ${response.status}）`);
    }

    const imageUrl = payload?.data?.links?.url || payload?.data?.url;
    if (!imageUrl) throw new Error('上传接口未返回图片地址');

    const copyButton = item.querySelector('.item-url');
    copyButton.dataset.url = imageUrl;
    copyButton.disabled = false;
    copyButton.title = '复制图片链接';

    status.textContent = `已上传 · ${formatBytes(file.size)}`;
    item.querySelector('.item-img img').src = imageUrl;
    if (item.previewUrl) {
      URL.revokeObjectURL(item.previewUrl);
      item.previewUrl = null;
    }
  } catch (error) {
    if (error.name === 'AbortError') return;
    item.classList.add('is-error');
    status.textContent = `上传失败 · ${error.message}`;
    showToast(error.message, 'error');
  } finally {
    uploadControllers.delete(item.id);
  }
};

const pumpUploads = () => {
  while (activeUploads < MAX_CONCURRENT_UPLOADS && uploadQueue.length) {
    const task = uploadQueue.shift();
    activeUploads += 1;
    runUpload(task).finally(() => {
      activeUploads -= 1;
      pumpUploads();
    });
  }
};

const queueUpload = (file, item) => {
  const controller = new AbortController();
  uploadControllers.set(item.id, controller);
  uploadQueue.push({ file, item, controller });
  pumpUploads();
};

const animateItem = (item, x, y) => {
  const itemImage = item.querySelector('.item-img');
  const children = item.querySelectorAll('*:not(.item-img)');
  const overlay = document.createElement('div');
  overlay.className = 'loaded-image';
  overlay.innerHTML = `
    <img alt="" />
    <span>
      <svg fill="#fff" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 330 330">
        <path d="M165 7.5c-8.284 0-15 6.716-15 15v60c0 8.284 6.716 15 15 15 8.284 0 15-6.716 15-15v-60c0-8.284-6.716-15-15-15z"/>
        <path d="M165 262.5c-8.284 0-15 6.716-15 15v30c0 8.284 6.716 15 15 15 8.284 0 15-6.716 15-15v-30c0-8.284-6.716-15-15-15z"/>
        <path d="M315 157.5h-60c-8.284 0-15 6.716-15 15s6.716 15 15 15h60c8.284 0 15-6.716 15-15s-6.716-15-15-15z"/>
        <path d="M90 172.5c0-8.284-6.716-15-15-15H15c-8.284 0-15 6.716-15 15s6.716 15 15 15h60c8.284 0 15-6.716 15-15z"/>
        <path d="M281.673 55.827c-5.857-5.858-15.355-5.858-21.213 0l-42.427 42.427c-5.858 5.858-5.858 15.355 0 21.213 2.929 2.929 6.768 4.394 10.606 4.394 3.839 0 7.678-1.464 10.607-4.394l42.427-42.427c5.858-5.858 5.858-15.355 0-21.213z"/>
        <path d="M90.753 225.533L48.328 267.96c-5.857 5.858-5.857 15.355 0 21.213 2.929 2.929 6.768 4.393 10.607 4.393 3.839 0 7.678-1.464 10.607-4.393l42.426-42.427c5.857-5.858 5.857-15.355 0-21.213-5.859-5.858-15.356-5.858-21.215 0z"/>
        <path d="M69.541 55.827c-5.858-5.858-15.355-5.857-21.213 0-5.858 5.858-5.858 15.355 0 21.213l42.426 42.427c2.93 2.929 6.768 4.394 10.607 4.394 3.838 0 7.678-1.465 10.606-4.393 5.858-5.858 5.858-15.355 0-21.213L69.541 55.827z"/>
      </svg>
    </span>`;
  overlay.querySelector('img').src = item.previewUrl;
  list.appendChild(overlay);

  const imageLeft = itemImage.offsetLeft;
  const imageTop = itemImage.offsetTop;
  const loadedImage = overlay.querySelector('img');
  const loadingIcon = overlay.querySelector('span');

  const timeline = gsap.timeline({
    onComplete: () => {
      overlay.remove();
      itemImage.style.opacity = 1;
      list.scrollTo(0, list.scrollHeight);
    },
  });
  timeline
    .set(droppable, { pointerEvents: 'none' })
    .fromTo(overlay, {
      autoAlpha: 1,
      width: 20,
      height: 20,
      x: x - 10,
      y: y - 10,
      borderRadius: '50%',
    }, {
      duration: 0.3,
      width: 70,
      height: 70,
      x: x - 30,
      y: y - 30,
    })
    .to(loadingIcon, { autoAlpha: 1, duration: 0.35 }, 'loading')
    .to(overlay, { rotation: 720, duration: 1.2 }, 'loading')
    .to(loadingIcon, { autoAlpha: 0, duration: 0.35 })
    .to(loadedImage, { autoAlpha: 1, duration: 0.35 }, '-=.1')
    .to(overlay, {
      x: imageLeft,
      y: imageTop,
      duration: 0.8,
      autoAlpha: 1,
      width: 60,
      height: 48,
      borderRadius: 4,
    }, '-=.5')
    .set(itemImage, { autoAlpha: 1 })
    .fromTo(children, { autoAlpha: 0, y: 30 }, { autoAlpha: 1, y: 0, duration: 0.3, stagger: 0.05 })
    .to(overlay, { autoAlpha: 0, duration: 0.3 }, '-=.2')
    .set(droppable, { pointerEvents: 'all' });
};

const addItem = (file, previewUrl, x, y) => {
  const item = document.createElement('div');
  const id = `item-${Math.random().toString(36).slice(2, 11)}`;
  item.className = 'item';
  item.id = id;
  item.previewUrl = previewUrl;
  item.innerHTML = `
    <div class="item-img"><img alt="" /></div>
    <div class="item-details">
      <div class="item-name"></div>
      <div class="item-size">等待上传</div>
    </div>
    <button class="item-delete" type="button" aria-label="移除"></button>
    <button class="item-delete item-url" type="button" disabled aria-label="复制图片链接" title="上传完成后复制链接"></button>`;

  item.querySelector('.item-img img').src = previewUrl;
  item.querySelector('.item-name').textContent = file.name;
  item.querySelector('.item-size').textContent = `等待上传 · ${formatBytes(file.size)}`;

  item.querySelector('.item-delete:not(.item-url)').addEventListener('click', (event) => {
    event.stopPropagation();
    removeItem(item);
  });
  item.querySelector('.item-url').addEventListener('click', (event) => {
    event.stopPropagation();
    copyToClipboard(event.currentTarget);
  });

  list.appendChild(item);
  animateItem(item, x, y);
  queueUpload(file, item);
};

const handleFiles = (files, x = 50, y = 50) => {
  const images = files.filter((file) => file.type.startsWith('image/'));
  if (!images.length) {
    showToast('请选择图片文件', 'error');
    return;
  }
  if (images.length !== files.length) showToast('已忽略非图片文件', 'error');

  images.forEach((file, index) => {
    const previewUrl = URL.createObjectURL(file);
    addItem(file, previewUrl, x + (index % 3) * 18, y + Math.floor(index / 3) * 18);
  });
};

list.addEventListener('click', () => input.click());
input.addEventListener('change', () => {
  handleFiles(Array.from(input.files));
  input.value = '';
});
