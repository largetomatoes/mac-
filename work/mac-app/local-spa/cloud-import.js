(function () {
  'use strict';
  if (window.__wenjianCloudImport) return;
  window.__wenjianCloudImport = true;

  var STYLE = [
    '.cloud-import-overlay{position:fixed;inset:0;z-index:2147483000;display:flex;align-items:center;justify-content:center;background:rgba(48,69,82,.34);font-family:-apple-system,"Segoe UI","Microsoft YaHei",sans-serif}',
    '.cloud-import-panel{background:#fcfdfc;color:#334e59;border:1px solid #d6e1e2;border-radius:12px;width:min(600px,calc(100vw - 32px));max-height:86vh;overflow:auto;padding:24px 26px;box-shadow:0 24px 64px rgba(48,69,82,.28)}',
    '.cloud-import-panel h2{margin:0 0 8px;font-size:19px;font-weight:600;color:#28424c}',
    '.cloud-import-lead{margin:0 0 18px;font-size:13px;line-height:1.8;color:#687d82}',
    '.cloud-import-sources{display:grid;gap:10px}',
    '.cloud-import-source{display:block;width:100%;text-align:left;background:#fff;border:1px solid #bdccd0;border-radius:9px;padding:13px 15px;cursor:pointer;font-size:14px;color:#334e59}',
    '.cloud-import-source:hover,.cloud-import-source:focus-visible{background:#e4eeef;border-color:#8fa8ae}',
    '.cloud-import-source b{display:block;font-size:14px;margin-bottom:3px}',
    '.cloud-import-source span{color:#819398;font-size:12px;line-height:1.7}',
    '.cloud-import-form{display:grid;gap:13px}',
    '.cloud-import-field{display:grid;gap:5px}',
    '.cloud-import-field label{font-size:12px;color:#687d82}',
    '.cloud-import-field input{font-size:13px;padding:8px 11px;border:1px solid #bdccd0;border-radius:8px;background:#fff;color:#334e59}',
    '.cloud-import-field input:focus{outline:2px solid #aabfc7;outline-offset:1px}',
    '.cloud-import-hint{font-size:12px;line-height:1.8;color:#819398;margin:0}',
    '.cloud-import-actions{display:flex;gap:10px;justify-content:flex-end;margin-top:18px;flex-wrap:wrap}',
    '.cloud-import-btn{font-size:13px;padding:8px 16px;border-radius:8px;border:1px solid #bdccd0;background:#fff;color:#415861;cursor:pointer}',
    '.cloud-import-btn:hover{background:#e4eeef}',
    '.cloud-import-btn.primary{background:#53717b;border-color:#53717b;color:#fff}',
    '.cloud-import-btn.primary:hover{background:#456068}',
    '.cloud-import-btn.danger{background:#a4553f;border-color:#a4553f;color:#fff}',
    '.cloud-import-btn.danger:hover{background:#8d452f}',
    '.cloud-import-btn[disabled]{opacity:.55;cursor:default}',
    '.cloud-import-error{margin:12px 0 0;padding:9px 12px;border-radius:8px;background:#fbeeec;border:1px solid #e3bdb2;color:#8d452f;font-size:12px;line-height:1.8;white-space:pre-wrap}',
    '.cloud-import-status{margin:14px 0 0;font-size:13px;line-height:1.8;color:#415861}',
    '.cloud-import-list{display:grid;gap:9px;margin-top:6px;max-height:38vh;overflow:auto}',
    '.cloud-import-row{display:grid;gap:4px;text-align:left;width:100%;background:#fff;border:1px solid #d6e1e2;border-radius:9px;padding:11px 13px;cursor:pointer;color:#334e59}',
    '.cloud-import-row:hover{background:#f3f6f5}',
    '.cloud-import-row[aria-pressed="true"]{border-color:#53717b;background:#eef4f4}',
    '.cloud-import-row b{font-size:13px;font-weight:600;word-break:break-all}',
    '.cloud-import-row span{font-size:11px;color:#819398}',
    '.cloud-import-confirm{margin-top:16px;padding:13px 15px;border:1px solid #e3bdb2;background:#fbf6f4;border-radius:9px;display:grid;gap:9px}',
    '.cloud-import-confirm p{margin:0;font-size:12px;line-height:1.8;color:#8d452f}',
    '.cloud-import-progress{height:7px;border-radius:5px;background:#e4e9e9;overflow:hidden;margin-top:12px}',
    '.cloud-import-progress>div{height:100%;background:#53717b;width:0;transition:width .4s}',
    '.cloud-import-fallback{margin:18px auto 0;display:block}'
  ].join('');

  function h(tag, props, children) {
    var node = document.createElement(tag);
    var key;
    if (props) for (key in props) {
      if (!Object.prototype.hasOwnProperty.call(props, key) || props[key] === undefined || props[key] === null) continue;
      if (key === 'class') node.className = props[key];
      else if (key === 'text') node.textContent = props[key];
      else if (key.slice(0, 2) === 'on') node.addEventListener(key.slice(2), props[key]);
      else node.setAttribute(key, props[key]);
    }
    var list = children || [];
    for (var i = 0; i < list.length; i += 1) {
      if (!list[i]) continue;
      node.appendChild(typeof list[i] === 'string' ? document.createTextNode(list[i]) : list[i]);
    }
    return node;
  }

  function fmtSize(n) {
    if (typeof n !== 'number' || !isFinite(n) || n < 0) return '大小未知';
    if (n < 1024) return n + ' B';
    var units = ['KB', 'MB', 'GB', 'TB'];
    var value = n;
    for (var i = 0; i < units.length; i += 1) {
      value /= 1024;
      if (value < 1024) return (value < 10 ? value.toFixed(1) : Math.round(value)) + ' ' + units[i];
    }
    return (value / 1024).toFixed(1) + ' PB';
  }

  function fmtTime(iso) {
    if (!iso) return '时间未知';
    var date = new Date(iso);
    if (!isFinite(date.getTime())) return '时间未知';
    return date.toLocaleString('zh-CN', { hour12: false });
  }

  function shortName(key) {
    var parts = String(key || '').split('/');
    return parts[parts.length - 1] || key;
  }

  function sleep(ms) { return new Promise(function (resolve) { setTimeout(resolve, ms); }); }

  async function api(path, init) {
    var response = await fetch(path, init);
    var body = await response.json().catch(function () { return null; });
    if (!response.ok) {
      var error = new Error((body && (body.error || body.message)) || ('请求失败（' + response.status + '）'));
      error.status = response.status;
      throw error;
    }
    return body;
  }

  function postJson(path, payload) {
    return api(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload || {}) });
  }

  // ---------- wizard ----------
  var overlay = null;
  var panel = null;
  var state = null;

  function showError(message) {
    var old = panel.querySelector('.cloud-import-error');
    if (old) old.parentNode.removeChild(old);
    panel.appendChild(h('p', { class: 'cloud-import-error core-question-error', role: 'alert', text: String(message || '操作没有完成，请重试。') }));
  }

  function setBody(nodes) {
    while (panel.firstChild) panel.removeChild(panel.firstChild);
    for (var i = 0; i < nodes.length; i += 1) if (nodes[i]) panel.appendChild(nodes[i]);
    panel.scrollTop = 0;
  }

  function closeWizard() {
    if (overlay && overlay.parentNode) overlay.parentNode.removeChild(overlay);
    overlay = null;
    panel = null;
    state = null;
  }

  function openWizard() {
    if (overlay) return;
    state = { username: '', password: '', oss: null };
    panel = h('div', { class: 'cloud-import-panel', role: 'document' });
    overlay = h('div', {
      class: 'cloud-import-overlay', role: 'dialog', 'aria-modal': 'true', 'aria-label': '导入已有备份',
      onclick: function (event) { if (event.target === overlay) closeWizard(); }
    }, [panel]);
    document.addEventListener('keydown', function onKey(event) {
      if (!overlay) { document.removeEventListener('keydown', onKey); return; }
      if (event.key === 'Escape') { event.preventDefault(); closeWizard(); }
    });
    document.body.appendChild(overlay);
    stepSource();
  }

  function footer(buttons) {
    return h('div', { class: 'cloud-import-actions' }, buttons);
  }

  function btn(label, onClick, kind, disabled) {
    return h('button', { type: 'button', class: 'cloud-import-btn' + (kind ? ' ' + kind : ''), onclick: onClick, disabled: disabled || undefined, text: label });
  }

  // ---------- step 1: source ----------
  function stepSource() {
    setBody([
      h('h2', { text: '导入已有备份' }),
      h('p', { class: 'cloud-import-lead', text: '选择备份来源。导入会用备份替换当前笔记、草稿和书籍清单；导入前会自动保留一份「恢复前」备用副本。' }),
      h('div', { class: 'cloud-import-sources' }, [
        h('button', { type: 'button', class: 'cloud-import-source', onclick: stepLocal }, [
          h('b', { text: '本机备份文件' }), h('span', { text: '从这台电脑上的 .wenjian-backup 完整备份恢复' })
        ]),
        h('button', { type: 'button', class: 'cloud-import-source', onclick: stepNutstore }, [
          h('b', { text: '从坚果云导入' }), h('span', { text: '邮箱 + 第三方应用密码，列出云端备份并导入' })
        ]),
        h('button', { type: 'button', class: 'cloud-import-source', onclick: function () { stepOss(); } }, [
          h('b', { text: '从阿里云 OSS 导入' }), h('span', { text: 'AccessKey ID / Secret、地域与 Bucket，列出云端快照并导入' })
        ])
      ]),
      footer([btn('取消', closeWizard)])
    ]);
  }

  // ---------- step 2a: local file ----------
  async function stepLocal() {
    setBody([
      h('h2', { text: '从本机备份文件导入' }),
      h('p', { class: 'cloud-import-status', text: '正在打开文件选择窗口，请在系统窗口中选择问间备份（.wenjian-backup）。' }),
      footer([])
    ]);
    try {
      // 与原「导入已有备份」按钮完全相同的调用：后端弹原生选档框并自动刷新页面。
      var response = await fetch('/api/backup/restore', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
      if (!response.ok) throw new Error('备份导入未完成，请重试。');
      setBody([
        h('h2', { text: '从本机备份文件导入' }),
        h('p', { class: 'cloud-import-status', text: '已处理完成。如果选择了备份文件，页面会自动刷新；如果没有选择文件，可以返回重试。' }),
        footer([btn('返回', stepSource), btn('关闭', closeWizard)])
      ]);
    } catch (error) {
      setBody([
        h('h2', { text: '从本机备份文件导入' }),
        h('p', { class: 'cloud-import-status', text: '没有完成导入。' }),
        footer([btn('返回', stepSource), btn('关闭', closeWizard)])
      ]);
      showError(error.message);
    }
  }

  // ---------- step 2b: nutstore ----------
  function stepNutstore() {
    var email = h('input', { type: 'email', value: state.username, placeholder: 'you@example.com', autocomplete: 'username' });
    var password = h('input', { type: 'password', value: state.password, placeholder: '坚果云安全选项中的第三方应用密码', autocomplete: 'current-password' });
    var form = h('div', { class: 'cloud-import-form' }, [
      h('div', { class: 'cloud-import-field' }, [h('label', { text: '坚果云邮箱' }), email]),
      h('div', { class: 'cloud-import-field' }, [h('label', { text: '应用密码' }), password]),
      h('p', { class: 'cloud-import-hint', text: '在坚果云网页「账户信息 → 安全选项」中添加第三方应用密码。问间只会读取「问间资料库」目录下的 .wenjian-backup 备份文件，不会改动其他内容。留空密码时，如果这台设备已保存同一账号的应用密码，会直接复用。' })
    ]);
    setBody([
      h('h2', { text: '从坚果云导入' }),
      h('p', { class: 'cloud-import-lead', text: '用坚果云账号连接云端，列出完整备份（.wenjian-backup）后选择导入。' }),
      form,
      footer([
        btn('返回', stepSource),
        btn('连接并列出备份', async function () {
          state.username = email.value.trim();
          state.password = password.value;
          if (!/^[^\s:@]+@[^\s:@]+\.[^\s:@]+$/.test(state.username)) { showError('请填写正确的坚果云邮箱。'); return; }
          if (!state.password && !state.username) { showError('请填写坚果云邮箱和应用密码。'); return; }
          try {
            var result = await postJson('/api/sync/backup-list', { username: state.username, password: state.password });
            stepNutstoreList(result.backups || []);
          } catch (error) { showError(error.message); }
        }, 'primary')
      ])
    ]);
    email.focus();
  }

  function stepNutstoreList(backups) {
    var list = h('div', { class: 'cloud-import-list' });
    var confirmBox = h('div');
    var selected = null;

    function refreshConfirm() {
      while (confirmBox.firstChild) confirmBox.removeChild(confirmBox.firstChild);
      if (!selected) return;
      var typed = h('input', { type: 'text', placeholder: '恢复', autocomplete: 'off' });
      var go = btn('确认导入', async function () {
        if (typed.value.trim() !== '恢复') { showError('请输入「恢复」确认。'); return; }
        go.disabled = true;
        try {
          await postJson('/api/sync/backup-restore', { id: selected.id, confirmation: '恢复', username: state.username, password: state.password });
          finishAndReload('导入完成，正在刷新页面…');
        } catch (error) {
          go.disabled = false;
          showError(error.message);
        }
      }, 'danger', true);
      typed.addEventListener('input', function () { go.disabled = typed.value.trim() !== '恢复'; });
      confirmBox.appendChild(h('div', { class: 'cloud-import-confirm' }, [
        h('p', { text: '导入这份备份会替换当前本机笔记、草稿和书籍清单。恢复前会自动保留备用副本。请输入「恢复」确认。' }),
        typed, h('div', { class: 'cloud-import-actions' }, [go])
      ]));
    }

    for (var i = 0; i < backups.length; i += 1) {
      (function (entry) {
        var row = h('button', {
          type: 'button', class: 'cloud-import-row', 'aria-pressed': 'false',
          onclick: function () {
            selected = entry;
            var rows = list.querySelectorAll('.cloud-import-row');
            for (var j = 0; j < rows.length; j += 1) rows[j].setAttribute('aria-pressed', rows[j] === row ? 'true' : 'false');
            refreshConfirm();
          }
        }, [
          h('b', { text: entry.name || entry.id }),
          h('span', { text: fmtTime(entry.createdAt) + ' · ' + fmtSize(entry.size) })
        ]);
        list.appendChild(row);
      })(backups[i]);
    }

    setBody([
      h('h2', { text: '选择坚果云备份' }),
      backups.length
        ? h('p', { class: 'cloud-import-lead', text: '共 ' + backups.length + ' 份云端备份，选择一份导入。' })
        : h('p', { class: 'cloud-import-lead', text: '云端还没有问间备份（.wenjian-backup 文件）。可以把「导出完整备份」得到的备份文件放进坚果云的「问间资料库」目录后再试。' }),
      backups.length ? list : null,
      confirmBox,
      footer([btn('返回', stepNutstore), btn('取消', closeWizard)])
    ]);
  }

  // ---------- step 2c: aliyun oss ----------
  async function stepOss() {
    if (!state.oss) {
      state.oss = { region: '', bucket: '', prefix: 'wenjian', accessKeyId: '', accessKeySecret: '' };
      try {
        var saved = await api('/api/cloud/config');
        if (saved && saved.configured) {
          state.oss.region = saved.region || '';
          state.oss.bucket = saved.bucket || '';
          state.oss.prefix = String(saved.prefix || 'wenjian/').replace(/\/+$/, '');
          state.oss.accessKeyId = saved.accessKeyId || '';
        }
      } catch (error) { /* 未配置时直接显示空表单 */ }
    }
    var fields = [
      ['region', '地域', 'oss-cn-hangzhou', 'text'],
      ['bucket', 'Bucket', 'my-bucket', 'text'],
      ['prefix', '备份目录', 'wenjian', 'text'],
      ['accessKeyId', 'AccessKey ID', 'LTAI…', 'text'],
      ['accessKeySecret', 'AccessKey Secret', '留空则保留已保存的密钥', 'password']
    ];
    var inputs = {};
    var form = h('div', { class: 'cloud-import-form' });
    fields.forEach(function (field) {
      var input = h('input', { type: field[3], value: state.oss[field[0]] || '', placeholder: field[2], autocomplete: 'off' });
      inputs[field[0]] = input;
      form.appendChild(h('div', { class: 'cloud-import-field' }, [h('label', { text: field[1] }), input]));
    });
    form.appendChild(h('p', { class: 'cloud-import-hint', text: '密钥仅用于这台设备访问你的 OSS，保存后不会在这里显示。备份目录对应 OSS 上存放快照的前缀，通常保持默认 wenjian 即可。' }));
    setBody([
      h('h2', { text: '从阿里云 OSS 导入' }),
      h('p', { class: 'cloud-import-lead', text: '填写 OSS 连接信息后，列出云端完整备份（快照）并选择导入。' }),
      form,
      footer([
        btn('返回', stepSource),
        btn('保存并列出备份', async function () {
          var payload = {
            region: inputs.region.value.trim(),
            bucket: inputs.bucket.value.trim(),
            prefix: inputs.prefix.value.trim() || 'wenjian',
            accessKeyId: inputs.accessKeyId.value.trim(),
            accessKeySecret: inputs.accessKeySecret.value
          };
          if (!payload.region || !payload.bucket || !payload.accessKeyId) { showError('请填写地域、Bucket 和 AccessKey ID。'); return; }
          state.oss = payload;
          try {
            await api('/api/cloud/config', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
            var result = await api('/api/cloud/snapshots');
            stepOssList(result.snapshots || []);
          } catch (error) { showError(error.message); }
        }, 'primary')
      ])
    ]);
  }

  function stepOssList(snapshots) {
    var list = h('div', { class: 'cloud-import-list' });
    var confirmBox = h('div');
    var selected = null;

    function refreshConfirm() {
      while (confirmBox.firstChild) confirmBox.removeChild(confirmBox.firstChild);
      if (!selected) return;
      var typed = h('input', { type: 'text', placeholder: '恢复', autocomplete: 'off' });
      var go = btn('确认恢复', async function () {
        if (typed.value.trim() !== '恢复') { showError('请输入「恢复」确认。'); return; }
        go.disabled = true;
        try {
          await postJson('/api/cloud/restore', { key: selected.key, confirmation: '恢复' });
          await pollCloudJob();
        } catch (error) {
          go.disabled = false;
          showError(error.message);
        }
      }, 'danger', true);
      typed.addEventListener('input', function () { go.disabled = typed.value.trim() !== '恢复'; });
      confirmBox.appendChild(h('div', { class: 'cloud-import-confirm' }, [
        h('p', { text: '恢复这份云端备份会替换当前本机笔记、草稿和书籍清单。恢复前会自动保留备用副本。请输入「恢复」确认。' }),
        typed, h('div', { class: 'cloud-import-actions' }, [go])
      ]));
    }

    for (var i = 0; i < snapshots.length; i += 1) {
      (function (entry) {
        var row = h('button', {
          type: 'button', class: 'cloud-import-row', 'aria-pressed': 'false', title: entry.key,
          onclick: function () {
            selected = entry;
            var rows = list.querySelectorAll('.cloud-import-row');
            for (var j = 0; j < rows.length; j += 1) rows[j].setAttribute('aria-pressed', rows[j] === row ? 'true' : 'false');
            refreshConfirm();
          }
        }, [
          h('b', { text: shortName(entry.key) }),
          h('span', { text: fmtTime(entry.createdAt) + ' · ' + fmtSize(entry.size) })
        ]);
        list.appendChild(row);
      })(snapshots[i]);
    }

    setBody([
      h('h2', { text: '选择云端备份' }),
      snapshots.length
        ? h('p', { class: 'cloud-import-lead', text: '共 ' + snapshots.length + ' 份云端备份，选择一份导入。' })
        : h('p', { class: 'cloud-import-lead', text: '这个 OSS 位置还没有云端备份。可以先在另一台设备或云备份对话框里「上传完整备份」。' }),
      snapshots.length ? list : null,
      confirmBox,
      footer([btn('返回', stepOss), btn('取消', closeWizard)])
    ]);
  }

  async function pollCloudJob() {
    var stage = h('p', { class: 'cloud-import-status', text: '正在恢复云端备份…' });
    var bar = h('div');
    var track = h('div', { class: 'cloud-import-progress' }, [bar]);
    setBody([
      h('h2', { text: '正在导入' }),
      stage, track,
      h('p', { class: 'cloud-import-hint', text: '备份较大时需要一些时间，完成前请保持应用打开。' }),
      footer([])
    ]);
    for (var i = 0; i < 3600; i += 1) {
      await sleep(1000);
      var job = await api('/api/cloud/job');
      if (job.state === 'running') {
        if (job.stage) stage.textContent = job.stage + '…';
        bar.style.width = (typeof job.progress === 'number' ? Math.max(0, Math.min(100, job.progress)) : 0) + '%';
        continue;
      }
      if (job.state === 'done') {
        bar.style.width = '100%';
        finishAndReload((job.message || '资料已从云端恢复') + '，正在刷新页面…');
        return;
      }
      setBody([
        h('h2', { text: '导入没有完成' }),
        h('p', { class: 'cloud-import-status', text: '云端恢复失败，本机资料没有被修改。' }),
        footer([btn('返回', stepSource), btn('关闭', closeWizard)])
      ]);
      showError(job.message || '云端恢复失败。');
      return;
    }
    throw new Error('等待云端恢复超时，请稍后在云备份对话框中查看结果。');
  }

  function finishAndReload(message) {
    setBody([
      h('h2', { text: '完成' }),
      h('p', { class: 'cloud-import-status', text: message })
    ]);
    setTimeout(function () { location.reload(); }, 400);
  }

  // ---------- injection & interception ----------
  function onCaptureClick(event) {
    var target = event.target;
    var button = target && target.closest ? target.closest('button.core-import-backup') : null;
    if (!button || button.disabled) return;
    event.preventDefault();
    event.stopPropagation();
    openWizard();
  }

  function maybeInjectFallback() {
    try {
      var onboarding = document.querySelector('.core-onboarding');
      if (!onboarding) return;
      if (document.querySelector('button.core-import-backup') || document.querySelector('.cloud-import-fallback')) return;
      var section = onboarding.querySelector('section') || onboarding;
      section.appendChild(h('button', {
        type: 'button', class: 'core-import-backup cloud-import-fallback', text: '从云端导入已有备份',
        onclick: function () { openWizard(); }
      }));
    } catch (error) { /* 引导页尚未渲染 */ }
  }

  function boot() {
    try {
      var style = document.createElement('style');
      style.textContent = STYLE;
      (document.head || document.documentElement).appendChild(style);
      window.addEventListener('click', onCaptureClick, true);
      new MutationObserver(maybeInjectFallback).observe(document.documentElement, { childList: true, subtree: true });
      maybeInjectFallback();
    } catch (error) { /* 注入失败时不影响应用本身 */ }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true });
  else boot();
})();
