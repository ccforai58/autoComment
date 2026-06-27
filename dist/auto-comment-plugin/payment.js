const USER_ID_STORAGE_KEY = 'auto_comment_user_id';
const API_BASE = 'https://jieyunsang.cn/api';

const PLANS = {
  blog_250: {
    name: '博客列表基础包',
    priceText: '¥19.9'
  },
  as_50: {
    name: '高 AS 博客精选包',
    priceText: '¥19.9'
  }
};

document.addEventListener('DOMContentLoaded', () => {
  const backBtn = document.getElementById('backBtn');
  const payBtn = document.getElementById('payBtn');
  const payStatus = document.getElementById('payStatus');
  const userIdText = document.getElementById('userIdText');
  const planNameText = document.getElementById('planNameText');
  const priceText = document.getElementById('priceText');
  const planCards = Array.from(document.querySelectorAll('.plan-card'));

  let selectedPlanId = 'blog_250';
  let currentUserId = '';

  function renderSelectedPlan() {
    const selectedPlan = PLANS[selectedPlanId];
    planCards.forEach((card) => {
      card.classList.toggle('selected', card.dataset.planId === selectedPlanId);
    });
    planNameText.textContent = selectedPlan.name;
    priceText.textContent = selectedPlan.priceText;
    payStatus.textContent = '选择套餐后点击支付宝支付，将创建订单并跳转到支付宝收银台。';
  }

  function setPayStatus(text, isError = false) {
    payStatus.textContent = text;
    payStatus.style.color = isError ? '#dc2626' : '#6b7280';
  }

  function setPayLoading(isLoading) {
    payBtn.disabled = isLoading;
    payBtn.textContent = isLoading ? '正在创建订单...' : '支付宝支付';
  }

  function openUrl(url) {
    if (typeof chrome !== 'undefined' && chrome.tabs) {
      chrome.tabs.create({ url });
      return;
    }
    window.open(url, '_blank', 'noopener,noreferrer');
  }

  function loadUserId() {
    if (typeof chrome === 'undefined' || !chrome.storage || !chrome.storage.sync) {
      userIdText.textContent = '未设置';
      return;
    }

    chrome.storage.sync.get([USER_ID_STORAGE_KEY], (data) => {
      currentUserId = data && data[USER_ID_STORAGE_KEY] ? String(data[USER_ID_STORAGE_KEY]).trim() : '';
      userIdText.textContent = currentUserId || '未设置';
      if (!currentUserId) {
        setPayStatus('请先返回设置页填写并保存用户 ID。', true);
      }
    });
  }

  planCards.forEach((card) => {
    card.addEventListener('click', () => {
      selectedPlanId = card.dataset.planId;
      renderSelectedPlan();
    });
    card.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      event.preventDefault();
      selectedPlanId = card.dataset.planId;
      renderSelectedPlan();
    });
  });

  backBtn.addEventListener('click', () => {
    if (typeof chrome !== 'undefined' && chrome.tabs) {
      chrome.tabs.create({ url: 'options.html' });
      return;
    }
    window.location.href = 'options.html';
  });

  payBtn.addEventListener('click', async () => {
    if (!currentUserId) {
      setPayStatus('请先返回设置页填写并保存用户 ID。', true);
      return;
    }

    setPayLoading(true);
    setPayStatus('正在创建支付宝订单...');

    try {
      const response = await fetch(`${API_BASE}/alipay/create-order`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: currentUserId,
          planId: selectedPlanId
        })
      });
      const data = await response.json();

      if (!response.ok || !data.success) {
        setPayStatus(data.message || data.error || '创建订单失败，请稍后重试。', true);
        return;
      }

      setPayStatus('订单已创建，正在打开支付宝收银台。支付完成后请回到设置页查看套餐状态。');
      openUrl(data.payUrl);
    } catch (error) {
      console.error('创建支付宝订单失败:', error);
      setPayStatus('网络错误，创建订单失败。', true);
    } finally {
      setPayLoading(false);
    }
  });

  renderSelectedPlan();
  loadUserId();
});
