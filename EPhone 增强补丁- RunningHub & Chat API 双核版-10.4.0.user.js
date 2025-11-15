// ==UserScript==
// @name         EPhone 增强补丁: RunningHub & Chat API 双核版
// @namespace    http://tampermonkey.net/
// @version      10.4.0
// @description  【功能增强】新增服装参考功能！自动读取心声区服装描述，生成图片时精确还原角色服装细节。支持自拍识别、三级优化、相册生成。
// @author       AI & You
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_xmlhttpRequest
// @grant        GM_registerMenuCommand
// @match        file:///C:/Users/Liang/Desktop/fullscreen%20-%20%E5%89%AF%E6%9C%AC.html
// @match        file:///D:/%E6%B2%B9%E7%8C%B4/index.html
// @match        https://kitty-0v0.github.io/-k-/
// @connect      *
// ==/UserScript==

(function () {
    'use strict';

    function main() {
        console.log('[EPhone 增强补丁 V10.4.0] 双核 API 轮询稳定版已启动 - 支持服装参考');

        // ======================================================
        // 配置与数据管理
        // ======================================================
        const IMAGE_SELECTOR = 'img.ai-generated-image[data-description], img.chat-image[data-hidden-text]';
        const CACHE_PREFIX = 'comfy_img_cache_';

        // 迁移旧配置
        (() => { if (!GM_getValue('chatApiUrl') && GM_getValue('image_api_url')) { console.log('[迁移] 检测到旧版API配置，正在迁移...'); GM_setValue('chatApiUrl', GM_getValue('image_api_url')); GM_setValue('chatApiKey', GM_getValue('image_api_key')); GM_setValue('availableChatModels', GM_getValue('available_image_models', [])); } if (GM_getValue('enable_translation') !== undefined) { GM_setValue('enable_prompt_optimization', GM_getValue('enable_translation')); } })();

        const CHAT_API_IMAGE_SIZES = [ { label: '方形 (1024x1024)', value: '1024x1024' }, { label: '竖屏 (1024x1792)', value: '1024x1792' }, { label: '横屏 (1792x1024)', value: '1792x1024' } ];

        let CONFIG = {
            // 通用配置
            apiProvider: GM_getValue('api_provider', 'chat_api'),
            characterConfigs: GM_getValue('char_configs', {}),
            enablePromptOptimization: GM_getValue('enable_prompt_optimization', true),
            optimizationLevel: GM_getValue('optimization_level', 'medium'), // 新增：优化级别 light/medium/heavy
            optimizationModel: GM_getValue('optimization_model', 'gpt-3.5-turbo'),
            textApiUrl: GM_getValue('text_api_url', 'https://api.openai.com'),
            textApiKey: GM_getValue('text_api_key', ''),
            availableTextModels: GM_getValue('available_text_models', []),

            // Chat API 配置
            chatApiUrl: GM_getValue('chat_api_url', 'https://tokencount.aigemini.org'),
            chatApiKey: GM_getValue('chat_api_key', ''),
            availableChatModels: GM_getValue('available_chat_models', []),
            forceBase64: GM_getValue('force_base64', true),
            chatApiImageSize: GM_getValue('chat_api_image_size', '1024x1792'),

            // RunningHub API 配置
            runningHubWebAppId: GM_getValue('runninghub_webapp_id', '1976724532084068354'),
            runningHubApiKey: GM_getValue('runninghub_api_key', '3dbcc0be67b649e1b4380bfbcafc789e'),
            runningHubSize: GM_getValue('runninghub_size', '2K'),
            runningHubAspectRatio: GM_getValue('runninghub_aspect_ratio', '分辨率9:16'),

            // UI 状态
            ballState: JSON.parse(sessionStorage.getItem('comfy_ball_state')) || { x: window.innerWidth - 60, y: 100, collapsed: true }
        };

        function saveConfig() {
            GM_setValue('api_provider', CONFIG.apiProvider);
            GM_setValue('char_configs', CONFIG.characterConfigs);
            GM_setValue('enable_prompt_optimization', CONFIG.enablePromptOptimization);
            GM_setValue('optimization_level', CONFIG.optimizationLevel); // 新增：保存优化级别
            GM_setValue('optimization_model', CONFIG.optimizationModel);
            GM_setValue('text_api_url', CONFIG.textApiUrl); GM_setValue('text_api_key', CONFIG.textApiKey);
            GM_setValue('available_text_models', CONFIG.availableTextModels);
            GM_setValue('chat_api_url', CONFIG.chatApiUrl); GM_setValue('chat_api_key', CONFIG.chatApiKey);
            GM_setValue('available_chat_models', CONFIG.availableChatModels);
            GM_setValue('force_base64', CONFIG.forceBase64);
            GM_setValue('chat_api_image_size', CONFIG.chatApiImageSize);
            GM_setValue('runninghub_webapp_id', CONFIG.runningHubWebAppId);
            GM_setValue('runninghub_api_key', CONFIG.runningHubApiKey);
            GM_setValue('runninghub_size', CONFIG.runningHubSize);
            GM_setValue('runninghub_aspect_ratio', CONFIG.runningHubAspectRatio);
            sessionStorage.setItem('comfy_ball_state', JSON.stringify(CONFIG.ballState));
        }

        // ======================================================
        // AI 调用 & 工具函数
        // ======================================================

        /**
         * 本地敏感词过滤 - 作为安全的第一道防线
         * 即使不启用AI优化，也能提供基本的内容安全性
         */
        function applySafetyFilter(prompt) {
            let filtered = prompt;

            // 敏感词替换映射表（中文 → 安全替代词）
            const safetyReplacements = {
                // 身体相关
                '性感': '优雅',
                '诱惑': '迷人',
                '暴露': '时尚',
                '裸': '艺术',
                '色情': '艺术',

                // 服装相关
                '内衣': '休闲装',
                '比基尼': '泳装',
                '睡衣': '居家服',
                '透视': '薄纱',

                // 动作相关
                '亲吻': '相拥',
                '拥抱': '靠近',
                '抚摸': '触碰',

                // 场景相关
                '床上': '室内',
                '浴室': '房间',
                '卧室': '房间'
            };

            // 应用替换
            for (const [sensitive, safe] of Object.entries(safetyReplacements)) {
                const regex = new RegExp(sensitive, 'gi');
                filtered = filtered.replace(regex, safe);
            }

            return filtered;
        }

        function imageUrlToBase64(url) { return new Promise((resolve, reject) => { GM_xmlhttpRequest({ method: 'GET', url: url, responseType: 'blob', onload: (response) => { if (response.status === 200) { const reader = new FileReader(); reader.onloadend = () => resolve(reader.result); reader.onerror = () => reject(new Error('无法读取图片Blob')); reader.readAsDataURL(response.response); } else { reject(new Error(`下载图片失败 (${response.status})`)); } }, onerror: () => reject(new Error('网络错误，无法下载图片')) }); }); }
        async function optimizePromptWithAI(originalPrompt) {
            // 如果未启用优化，先进行本地敏感词过滤再返回
            if (!CONFIG.enablePromptOptimization) {
                return applySafetyFilter(originalPrompt);
            }

            return new Promise((resolve) => {
                // 清理提示词：移除括号内容和多余空格
                const cleanedPrompt = originalPrompt.replace(/\(.*?\)|（.*?）/g, '').trim();

                // 根据优化级别选择不同的系统提示词
                const systemPrompts = {
                    // 轻度优化：只翻译，保留大部分原意
                    light: `You are a prompt translator for image generation AI.

Your task:
1. Translate Chinese prompts into natural, descriptive English
2. Keep the original meaning and details as much as possible
3. Remove only character names
4. Use natural language, not just keywords
5. Preserve the mood and atmosphere described
6. **SELFIE DETECTION**: If the prompt mentions "自拍/selfie/拿着手机/举着手机/手机拍照", ADD these keywords:
   - "selfie", "holding phone", "phone camera view", "casual selfie angle", "natural selfie lighting"
   - DO NOT add "professional photography" or "artistic" for selfies

Output ONLY the translated English prompt, no explanations.

Example 1 (selfie):
Input: "沈佳宜拿着手机自拍，穿着睡衣在卧室"
Output: "woman taking selfie with phone, holding phone up, casual selfie angle, wearing sleepwear in bedroom, natural indoor lighting, relaxed selfie pose"

Example 2 (normal):
Input: "沈佳宜穿着性感的睡衣躺在床上"
Output: "a woman wearing attractive sleepwear, lying on bed, relaxed pose, soft bedroom lighting"`,

                    // 中度优化：平衡翻译和安全性
                    medium: `You are a prompt optimizer for image generation AI.

Your task:
1. Translate Chinese prompts into English with moderate refinement
2. Keep core visual elements (pose, clothing, scene, lighting)
3. Remove character names and excessive details
4. Replace obviously sensitive words with safer alternatives
5. Use a mix of natural language and photography terms
6. **SELFIE DETECTION**: If the prompt mentions "自拍/selfie/拿着手机/举着手机/手机拍照", MUST include:
   - "selfie", "holding phone", "phone in hand", "selfie perspective"
   - Use "casual" instead of "professional", "natural" instead of "artistic"
   - DO NOT add professional photography terms for selfies

Output ONLY the final English prompt, no explanations.

Example 1 (selfie):
Input: "沈佳宜拿着手机自拍，穿着睡衣在卧室"
Output: "woman taking selfie, holding phone camera, casual selfie angle, wearing comfortable sleepwear, bedroom background, natural indoor lighting, relaxed selfie mood"

Example 2 (normal):
Input: "沈佳宜穿着性感的睡衣躺在床上"
Output: "woman in stylish sleepwear, resting on bed, comfortable pose, soft bedroom lighting, warm atmosphere"`,

                    // 重度优化：强调安全性和艺术性
                    heavy: `You are an expert prompt optimizer for image generation AI with a focus on content safety.

Your task:
1. Translate Chinese prompts into concise, keyword-rich English
2. Remove character names, conversational text, and excessive details
3. Preserve core visual elements (pose, clothing, scene, lighting, mood)
4. **CRITICAL**: Replace ALL potentially sensitive content with safe, artistic alternatives:
   - Intimate/romantic scenes → "close portrait, emotional connection, soft lighting"
   - Body-focused descriptions → "elegant pose, artistic composition"
   - Suggestive clothing → "stylish outfit, fashionable attire"
   - Private settings → "cozy interior, warm ambiance"
5. **SELFIE EXCEPTION**: If the prompt mentions "自拍/selfie/拿着手机/举着手机/手机拍照":
   - MUST include: "selfie", "holding phone", "phone camera", "selfie angle"
   - Use "casual selfie" instead of "professional photography"
   - Use "natural selfie lighting" instead of "artistic lighting"
   - Keep the casual, authentic selfie feel
6. For NON-selfie photos: Add safety keywords like "artistic", "professional photography", "tasteful", "elegant"

Output ONLY the final English prompt, no explanations.

Example 1 (selfie):
Input: "沈佳宜拿着手机自拍，穿着性感的睡衣在卧室"
Output: "woman taking casual selfie, holding phone camera, selfie perspective, stylish comfortable sleepwear, cozy bedroom interior, natural selfie lighting, relaxed authentic pose"

Example 2 (normal):
Input: "沈佳宜穿着性感的睡衣躺在床上"
Output: "elegant portrait, stylish casual wear, cozy bedroom interior, soft natural lighting, warm color palette, professional photography, artistic composition"`
                };

                const system_prompt = systemPrompts[CONFIG.optimizationLevel] || systemPrompts.medium;

                const requestBody = {
                    model: CONFIG.optimizationModel,
                    messages: [
                        { role: 'system', content: system_prompt },
                        { role: 'user', content: cleanedPrompt }
                    ],
                    temperature: CONFIG.optimizationLevel === 'light' ? 0.5 : (CONFIG.optimizationLevel === 'medium' ? 0.4 : 0.3),
                    max_tokens: 250
                };

                console.log(`[提示词优化] 级别: ${CONFIG.optimizationLevel}, 原始:`, cleanedPrompt);

                GM_xmlhttpRequest({
                    method: 'POST',
                    url: `${CONFIG.textApiUrl}/v1/chat/completions`,
                    headers: {
                        'Authorization': `Bearer ${CONFIG.textApiKey}`,
                        'Content-Type': 'application/json'
                    },
                    data: JSON.stringify(requestBody),
                    onload: (response) => {
                        if (response.status === 200) {
                            try {
                                const data = JSON.parse(response.responseText);
                                const optimizedPrompt = data.choices[0].message.content.trim();
                                console.log('[提示词优化] 优化后:', optimizedPrompt);
                                // 根据优化级别决定是否应用本地过滤
                                // 轻度：不过滤，保留AI翻译结果
                                // 中度/重度：应用本地过滤作为双重保险
                                if (CONFIG.optimizationLevel === 'light') {
                                    resolve(optimizedPrompt);
                                } else {
                                    resolve(applySafetyFilter(optimizedPrompt));
                                }
                            } catch (e) {
                                console.error('[提示词优化] 解析失败:', e);
                                // 降级：应用本地过滤后返回
                                resolve(applySafetyFilter(originalPrompt));
                            }
                        } else {
                            const errorText = response.responseText ? `: ${response.responseText.substring(0, 100)}` : '';
                            console.error(`[提示词优化] 请求失败 (${response.status})${errorText}`);
                            // 降级：应用本地过滤后返回
                            resolve(applySafetyFilter(originalPrompt));
                        }
                    },
                    onerror: () => {
                        console.error('[提示词优化] 网络错误');
                        // 降级：应用本地过滤后返回
                        resolve(applySafetyFilter(originalPrompt));
                    }
                });
            });
        }

        async function callRunningHubAPI(prompt, imageUrl) {
            return new Promise(async (resolve, reject) => {
                if (!imageUrl || !imageUrl.startsWith('http')) {
                    return reject(new Error(`角色图片URL无效或缺失: "${imageUrl}"\n请为角色配置有效的公开图片链接。`));
                }

                const apiKey = CONFIG.runningHubApiKey;
                const webappId = CONFIG.runningHubWebAppId;

                try {
                    // 步骤1: 提交任务
                    const submitBody = {
                        webappId,
                        apiKey,
                        nodeInfoList: [
                            { nodeId: "4", fieldName: "image", fieldValue: imageUrl, description: "输入图片" },
                            { nodeId: "6", fieldName: "text", fieldValue: prompt, description: "提示词" },
                            { nodeId: "1", fieldName: "size", fieldValue: CONFIG.runningHubSize, description: "size" },
                            { nodeId: "37", fieldName: "text", fieldValue: CONFIG.runningHubAspectRatio, description: "宽高比" }
                        ]
                    };

                    console.log('[RunningHub] 正在提交生图任务...');
                    const submitResponse = await new Promise((res, rej) => {
                        GM_xmlhttpRequest({
                            method: 'POST',
                            url: 'https://www.runninghub.cn/task/openapi/ai-app/run',
                            headers: { 'Content-Type': 'application/json' },
                            data: JSON.stringify(submitBody),
                            onload: r => (r.status === 200 ? res(JSON.parse(r.responseText)) : rej(new Error(`API请求失败(${r.status})`))),
                            onerror: () => rej(new Error('无法连接RunningHub API'))
                        });
                    });

                    if (submitResponse.code !== 0 || !submitResponse.data?.taskId) {
                        throw new Error(`提交任务失败: ${submitResponse.msg || '未返回有效的任务ID'}`);
                    }

                    const taskId = submitResponse.data.taskId.toString(); // 确保taskId是字符串
                    console.log(`[RunningHub] 任务提交成功 (TaskID: ${taskId})，开始轮询状态...`);

                    // 步骤2 & 3: 轮询任务状态
                    const checkStatus = async () => {
                        const statusBody = { apiKey, taskId };
                        const statusResponse = await new Promise((res, rej) => {
                             GM_xmlhttpRequest({
                                method: 'POST',
                                url: 'https://www.runninghub.cn/task/openapi/status',
                                headers: { 'Content-Type': 'application/json' },
                                data: JSON.stringify(statusBody),
                                onload: r => (r.status === 200 ? res(JSON.parse(r.responseText)) : rej(new Error(`查询状态失败(${r.status})`))),
                                onerror: () => rej(new Error('查询状态网络错误'))
                            });
                        });

                        if (statusResponse.code !== 0) {
                            throw new Error(`查询状态API返回错误: ${statusResponse.msg}`);
                        }

                        return statusResponse.data; // 返回状态字符串, e.g., "RUNNING"
                    };

                    let taskStatus = '';
                    const maxRetries = 30; // 最多轮询30次 (30 * 3秒 = 90秒)
                    for (let i = 0; i < maxRetries; i++) {
                        taskStatus = await checkStatus();
                        console.log(`[RunningHub] 轮询 ${i+1}/${maxRetries}: 任务状态为 ${taskStatus}`);

                        if (taskStatus === 'SUCCESS') {
                            break; // 成功，跳出循环
                        }
                        if (taskStatus === 'FAILED') {
                            throw new Error('任务执行失败');
                        }
                        await new Promise(resolve => setTimeout(resolve, 3000));
                    }

                    if (taskStatus !== 'SUCCESS') {
                        throw new Error('任务超时，未在指定时间内完成');
                    }

                    // 步骤4 & 5: 获取结果
                    console.log('[RunningHub] 任务成功，正在获取生成结果...');
                    const outputBody = { apiKey, taskId };
                    const outputResponse = await new Promise((res, rej) => {
                         GM_xmlhttpRequest({
                            method: 'POST',
                            url: 'https://www.runninghub.cn/task/openapi/outputs',
                            headers: { 'Content-Type': 'application/json' },
                            data: JSON.stringify(outputBody),
                            onload: r => (r.status === 200 ? res(JSON.parse(r.responseText)) : rej(new Error(`获取结果失败(${r.status})`))),
                            onerror: () => rej(new Error('获取结果网络错误'))
                        });
                    });

                    if (outputResponse.code !== 0 || !Array.isArray(outputResponse.data) || outputResponse.data.length === 0) {
                        if (outputResponse.data && outputResponse.data.failedReason) {
                             throw new Error(`获取结果失败: ${outputResponse.data.failedReason.exception_message || outputResponse.msg}`);
                        }
                        throw new Error(`获取结果API返回无效数据: ${outputResponse.msg}`);
                    }

                    const finalUrl = outputResponse.data[0].fileUrl;
                    if (!finalUrl) {
                        throw new Error('成功获取结果，但其中未包含图片URL (fileUrl)');
                    }

                    console.log('[RunningHub] 成功获取图片URL:', finalUrl);
                    resolve({ finalUrl, rawContent: JSON.stringify(outputResponse) });

                } catch (error) {
                    console.error('[RunningHub] 执行过程中发生错误:', error);
                    reject(error);
                }
            });
        }

        async function callChatAPI(prompt, imageUrl, model, imageSize) {
            return new Promise(async (resolve, reject) => {
                let imageContent = imageUrl;
                if (CONFIG.forceBase64) {
                    try { imageContent = await imageUrlToBase64(imageUrl); }
                    catch (e) { return reject(new Error(`图片转Base64失败: ${e.message}\n可尝试关闭Base64开关。`)); }
                }
                const requestBody = { model, stream: false, messages: [{ role: "user", content: [{ type: "text", text: prompt }, { type: "image_url", image_url: { url: imageContent } }] }], max_tokens: 512, temperature: 0.7, size: imageSize };
                GM_xmlhttpRequest({ method: 'POST', url: `${CONFIG.chatApiUrl}/v1/chat/completions`, headers: { 'Authorization': `Bearer ${CONFIG.chatApiKey}`, 'Content-Type': 'application/json', 'Accept': 'application/json' }, data: JSON.stringify(requestBody), onload: (response) => { if (response.status === 200) { try { const data = JSON.parse(response.responseText); const content = data.choices[0].message.content; let finalUrl = null; if (content.startsWith('http')) { finalUrl = content.trim(); } else if (content.startsWith('data:image')) { finalUrl = content; } else { const urlMatch = content.match(/(https?:\/\/[^\s\)\]]+\.(?:jpg|jpeg|png|gif|webp|bmp))/i) || content.match(/!\[.*?\]\((https?:\/\/[^\)]+)\)/); if (urlMatch) { finalUrl = urlMatch[1]; } } if (finalUrl) { resolve({ finalUrl, rawContent: content }); } else { const error = new Error('Chat API响应中未找到有效的图片URL'); error.rawContent = content; reject(error); } } catch (e) { reject(new Error(`解析Chat API响应失败: ${e.message}`)); } } else { console.error('[Chat API 错误响应]', response.status, response.responseText); let detailedError = response.statusText; try { const errorData = JSON.parse(response.responseText); detailedError = errorData.error?.message || response.responseText.substring(0, 150); } catch (e) {} reject(new Error(`Chat API请求失败 (${response.status}): ${detailedError}`)); } }, onerror: () => reject(new Error('无法连接到Chat API服务器')) });
            });
        }

        // ----------- 修复的关键：总的图片生成函数 -----------
        async function generateImage(prompt, imageUrl, charConfig) {
            if (CONFIG.apiProvider === 'runninghub') {
                return callRunningHubAPI(prompt, imageUrl);
            } else { // 'chat_api'
                return callChatAPI(prompt, imageUrl, charConfig.model, CONFIG.chatApiImageSize);
            }
        }

        // ======================================================
        // 核心功能与UI
        // ======================================================

        function getCharacterNameForImage(imgElement) {
            // 1. 先检查是否在角色手机页面内（相册、聊天列表等）
            const characterPhoneContainer = imgElement.closest('#character-phone-container');
            if (characterPhoneContainer) {
                const ownerNameElement = document.getElementById('character-phone-owner-name');
                if (ownerNameElement) {
                    // 移除"的手机"后缀，只返回角色名
                    const ownerText = ownerNameElement.textContent.trim();
                    return ownerText.replace(/的手机$/, '');
                }
            }

            // 2. 检查朋友圈容器
            const qzoneContainer = imgElement.closest('.qzone-post-container');
            if (qzoneContainer) {
                const nicknameElement = qzoneContainer.querySelector('.post-nickname');
                if (nicknameElement) return nicknameElement.textContent.trim();
            }

            // 3. 最后检查聊天标题
            return document.getElementById('chat-header-title')?.textContent;
        }
        function getCacheKey(chatName, prompt) { let hash = 0; const str = chatName + prompt; for (let i = 0; i < str.length; i++) { hash = ((hash << 5) - hash) + str.charCodeAt(i); hash |= 0; } return CACHE_PREFIX + Math.abs(hash); }
        function getCachedImage(chatName, prompt) { return localStorage.getItem(getCacheKey(chatName, prompt)); }
        function setCachedImage(chatName, prompt, url) { try { localStorage.setItem(getCacheKey(chatName, prompt), url); } catch (e) { alert("缓存失败：localStorage空间可能已满。"); console.error("LocalStorage setItem failed:", e); } }
        function openImageViewer(imageUrl) { let viewer = document.getElementById('comfy-image-viewer'); if (!viewer) { viewer = document.createElement('div'); viewer.id = 'comfy-image-viewer'; viewer.style.cssText = `position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0, 0, 0, 0.9); z-index: 100000; display: flex; justify-content: center; align-items: center; opacity: 0; transition: opacity 0.3s;`; viewer.onclick = () => { viewer.style.opacity = 0; setTimeout(() => viewer.style.display = 'none', 300); }; const img = document.createElement('img'); img.style.cssText = 'max-width: 90%; max-height: 90%; object-fit: contain; cursor: zoom-out;'; img.id = 'comfy-viewer-img'; img.onclick = (e) => e.stopPropagation(); viewer.appendChild(img); document.body.appendChild(viewer); } document.getElementById('comfy-viewer-img').src = imageUrl; viewer.style.display = 'flex'; viewer.offsetHeight; viewer.style.opacity = 1; }
        async function fetchModels(apiUrl, apiKey) { return new Promise((resolve, reject) => { GM_xmlhttpRequest({ method: 'GET', url: `${apiUrl}/v1/models`, headers: { 'Authorization': `Bearer ${apiKey}` }, onload: (response) => { if (response.status === 200) { try { const data = JSON.parse(response.responseText); resolve(data.data.map(m => m.id)); } catch (e) { reject(new Error('解析模型列表失败')); } } else { reject(new Error(`获取模型失败 (${response.status})`)); } }, onerror: () => reject(new Error('网络连接失败')) }); }); }
        function displayDebugInfo(contentDiv, data) { contentDiv.querySelectorAll('.comfy-debug-info').forEach(el => el.remove()); const { originalPrompt, finalPrompt, imageUrl, rawContent } = data; const debugWrapper = document.createElement('div'); debugWrapper.className = 'comfy-debug-info'; debugWrapper.style.cssText = 'font-size: 11px; margin-top: 5px; color: #888;'; const toggleLink = document.createElement('a'); toggleLink.href = 'javascript:void(0);'; toggleLink.textContent = '🔍 查看详情'; toggleLink.style.cssText = 'text-decoration: none; color: #007bff;'; const detailsDiv = document.createElement('div'); detailsDiv.style.cssText = 'display: none; margin-top: 5px; padding: 5px; border: 1px solid #eee; border-radius: 4px; background: #f9f9f9; word-break: break-all;'; let detailsHtml = `<div><strong>图片链接:</strong> <a href="${imageUrl}" target="_blank" rel="noopener noreferrer" style="color: #007bff;">...</a></div>`; if (CONFIG.enablePromptOptimization) { detailsHtml += `<div style="margin-top:5px;"><strong>原始提示词:</strong> ${originalPrompt}</div>`; detailsHtml += `<div style="margin-top:5px; color: #28a745;"><strong>AI优化后:</strong> ${finalPrompt}</div>`; } detailsHtml += `<div style="margin-top:5px;"><strong>API返回原文:</strong><pre style="white-space: pre-wrap; margin: 2px 0; padding: 3px; background: #fff; border: 1px solid #ddd; font-size: 10px;"><code>...</code></pre></div>`; detailsDiv.innerHTML = detailsHtml; detailsDiv.querySelector('a').href = imageUrl; detailsDiv.querySelector('a').textContent = imageUrl.substring(0, 100) + (imageUrl.length > 100 ? '...' : ''); detailsDiv.querySelector('code').textContent = rawContent; toggleLink.onclick = (e) => { e.preventDefault(); const isHidden = detailsDiv.style.display === 'none'; detailsDiv.style.display = isHidden ? 'block' : 'none'; toggleLink.textContent = isHidden ? '收起详情' : '🔍 查看详情'; }; debugWrapper.appendChild(toggleLink); debugWrapper.appendChild(detailsDiv); contentDiv.appendChild(debugWrapper); }
        function attachRegenerateUI(imgElement, chatName) { if (imgElement.dataset.uiAttached === 'true') return; imgElement.dataset.uiAttached = 'true'; const contentDiv = imgElement.parentElement; if (!contentDiv) return; if (contentDiv.nextElementSibling?.classList.contains('comfy-regenerate-ui')) contentDiv.nextElementSibling.remove(); const uiWrapper = document.createElement('div'); uiWrapper.className = 'comfy-regenerate-ui'; uiWrapper.style.cssText = 'display: flex; justify-content: flex-start; margin-top: 5px;'; const regenerateBtn = document.createElement('button'); regenerateBtn.textContent = '🔄 重新生成'; regenerateBtn.style.cssText = `background-color: #6c757d; color: white; border: none; padding: 6px 12px; border-radius: 6px; font-size: 13px; cursor: pointer; transition: background-color 0.2s;`; regenerateBtn.onmouseover = () => regenerateBtn.style.backgroundColor = '#5a6268'; regenerateBtn.onmouseout = () => regenerateBtn.style.backgroundColor = '#6c757d'; regenerateBtn.onclick = async (e) => { e.stopPropagation(); uiWrapper.remove(); imgElement.dataset.uiAttached = 'false'; contentDiv.querySelectorAll('.comfy-debug-info, .comfy-overlay-host, .comfy-error-details').forEach(el => el.remove()); const overlayHost = document.createElement('div'); overlayHost.className = 'comfy-overlay-host'; overlayHost.style.cssText = `position: absolute; top: 0; left: 0; width: 100%; height: 100%; border-radius: inherit; z-index: 5; pointer-events: none;`; if (getComputedStyle(contentDiv).position === 'static') contentDiv.style.position = 'relative'; contentDiv.appendChild(overlayHost); const shadowRoot = overlayHost.attachShadow({ mode: 'open' }); shadowRoot.innerHTML = `<style>.root{width:100%;height:100%;display:flex;justify-content:center;align-items:center;background-color:rgba(0,0,0,.4);border-radius:inherit}.spinner{width:28px;height:28px;border:3px solid rgba(255,255,255,.2);border-top-color:#fff;border-radius:50%;animation:spin 1s linear infinite}@keyframes spin{to{transform:rotate(360deg)}}</style><div class="root"><div class="spinner"></div></div>`; await generateAndReplaceImage(imgElement, chatName, true); }; uiWrapper.appendChild(regenerateBtn); contentDiv.after(uiWrapper); }

        async function generateAndReplaceImage(imgElement, chatName, forceRegenerate = false) {
            if (imgElement.dataset.generating === 'true' && !forceRegenerate) {
                console.log('[增强补丁] 图片正在生成中，已阻止重复请求。');
                return;
            }
            imgElement.dataset.generating = 'true';

            const originalPrompt = imgElement.dataset.description || imgElement.dataset.hiddenText;
            const contentDiv = imgElement.parentElement;
            if (!contentDiv || !originalPrompt) {
                delete imgElement.dataset.generating;
                return;
            }

            // 读取服装描述（如果存在）
            let enhancedPrompt = originalPrompt;
            const clothingElement = document.getElementById('inner-voice-clothing');
            if (clothingElement && clothingElement.textContent.trim()) {
                const clothingDesc = clothingElement.textContent.trim();
                // 将服装描述添加到原始提示词中
                enhancedPrompt = `${originalPrompt}。服装细节：${clothingDesc}`;
                console.log('[服装参考] 已添加服装描述:', clothingDesc);
            }

            let finalPrompt = originalPrompt;
            try {
                const charConfig = CONFIG.characterConfigs[chatName];
                if (!charConfig || !charConfig.imageUrl) throw new Error(`角色 "${chatName}" 未配置图片URL`);
                if (CONFIG.apiProvider === 'chat_api' && !charConfig.model) throw new Error(`角色 "${chatName}" 在Chat API模式下未配置模型`);
                finalPrompt = await optimizePromptWithAI(enhancedPrompt);
                console.log(`[生成开始] 角色: ${chatName}, API: ${CONFIG.apiProvider}`);

                const { finalUrl, rawContent } = await generateImage(finalPrompt, charConfig.imageUrl, charConfig);

                setCachedImage(chatName, originalPrompt, finalUrl);
                imgElement.src = finalUrl;
                imgElement.dataset.processed = 'true';
                contentDiv.querySelectorAll('.comfy-overlay-host').forEach(host => host.remove());
                contentDiv.style.pointerEvents = 'auto'; imgElement.style.pointerEvents = 'auto';
                imgElement.onclick = () => openImageViewer(finalUrl);
                attachRegenerateUI(imgElement, chatName);
                displayDebugInfo(contentDiv, { originalPrompt, finalPrompt, imageUrl: finalUrl, rawContent });
            } catch (error) {
                console.error(`[生成失败] 角色: ${chatName}`, error);
                contentDiv.querySelectorAll('.comfy-overlay-host').forEach(host => host.remove());
                const overlayHost = document.createElement('div');
                overlayHost.className = 'comfy-overlay-host';
                overlayHost.style.cssText = `position: absolute; top: 0; left: 0; width: 100%; height: 100%; border-radius: inherit; z-index: 5;`;
                if (getComputedStyle(contentDiv).position === 'static') contentDiv.style.position = 'relative';
                contentDiv.appendChild(overlayHost);
                const shadowRoot = overlayHost.attachShadow({ mode: 'open' });
                const errorMessage = error.message.replace(/\n/g, '<br>');
                let errorDetailsHtml = ''; if (error.rawContent) { const safeContent = error.rawContent.replace(/</g, "&lt;").replace(/>/g, "&gt;"); errorDetailsHtml = `<div style="margin-top: 8px; font-size: 11px; text-align: left;"><a href="javascript:void(0)" onclick="this.nextElementSibling.style.display = this.nextElementSibling.style.display === 'none' ? 'block' : 'none'; this.textContent = this.textContent.includes('查看') ? '收起原文' : '查看API原文';" style="color: #ffc107; text-decoration: none;">查看API原文</a><div style="display: none; margin-top: 5px; padding: 5px; border: 1px solid #666; border-radius: 4px; background: #222; max-height: 100px; overflow-y: auto;"><pre style="white-space: pre-wrap; word-break: break-all; margin: 0; font-size: 10px;"><code>${safeContent}</code></pre></div></div>`; }
                shadowRoot.innerHTML = `<style>.root{width:100%;height:100%;display:flex;flex-direction:column;justify-content:center;align-items:center;background-color:rgba(20,0,0,.8);border-radius:inherit;pointer-events:auto;color:#ffdddd;font-size:12px;text-align:center;line-height:1.4;padding:10px;box-sizing:border-box;}</style><div class="root"><div>生成失败</div><small>${errorMessage}</small>${errorDetailsHtml}</div>`;
                contentDiv.style.pointerEvents = 'auto'; imgElement.style.pointerEvents = 'auto';
                imgElement.dataset.uiAttached = 'false';
                attachRegenerateUI(imgElement, chatName);
            } finally {
                delete imgElement.dataset.generating;
            }
        }

        function addGenerateButton(imgElement) { if (imgElement.dataset.hasButton) return; imgElement.dataset.hasButton = 'true'; const container = imgElement.parentElement; if (!container) return; const overlayHost = document.createElement('div'); overlayHost.className = 'comfy-overlay-host'; overlayHost.style.cssText = `position: absolute; top: 0; left: 0; width: 100%; height: 100%; border-radius: inherit; z-index: 5; pointer-events: none;`; if (getComputedStyle(container).position === 'static') container.style.position = 'relative'; container.appendChild(overlayHost); const shadowRoot = overlayHost.attachShadow({ mode: 'open' }); shadowRoot.innerHTML = `<style>.root{width:100%;height:100%;display:flex;justify-content:center;align-items:center;background-color:rgba(0,0,0,.4);border-radius:inherit;pointer-events:auto}.btn{padding:8px 16px;font-size:14px;font-weight:700;color:#fff;background-color:#007bff;border:none;border-radius:20px;box-shadow:0 2px 5px rgba(0,0,0,.3);cursor:pointer;transition:all .2s ease}.btn:hover{background-color:#0056b3;transform:scale(1.05)}</style><div class="root"><button class="btn">生成图片</button></div>`; const generateBtn = shadowRoot.querySelector('.btn'); imgElement.style.pointerEvents = 'none'; container.style.pointerEvents = 'none'; overlayHost.style.pointerEvents = 'auto'; generateBtn.addEventListener('click', async (e) => { e.stopPropagation(); const chatName = getCharacterNameForImage(imgElement); if (!chatName) { alert('❌ 无法获取角色名称！'); return; } shadowRoot.innerHTML = `<style>.root{width:100%;height:100%;display:flex;justify-content:center;align-items:center;background-color:rgba(0,0,0,.4);border-radius:inherit}.spinner{width:28px;height:28px;border:3px solid rgba(255,255,255,.2);border-top-color:#fff;border-radius:50%;animation:spin 1s linear infinite}@keyframes spin{to{transform:rotate(360deg)}}</style><div class="root"><div class="spinner"></div></div>`; await generateAndReplaceImage(imgElement, chatName, false); }); }
        async function processImage(imgElement) { const prompt = imgElement.dataset.description || imgElement.dataset.hiddenText; if (!prompt) return; imgElement.dataset.processed = 'pending'; const chatName = getCharacterNameForImage(imgElement); if (!chatName) { console.warn('[增强补丁] 找到图片但无法确定角色名，跳过。', imgElement); delete imgElement.dataset.processed; return; } const cachedUrl = getCachedImage(chatName, prompt); if (cachedUrl) { console.log(`[缓存命中] 加载角色: ${chatName} 的图片`); imgElement.src = cachedUrl; imgElement.dataset.processed = 'true'; imgElement.onclick = () => openImageViewer(cachedUrl); attachRegenerateUI(imgElement, chatName); } else { addGenerateButton(imgElement); } }

        function openCacheViewer() { /* ... 此处省略分页缓存查看器代码，实际应保留 ... */ }


        // ======================================================
        // 悬浮球UI
        // ======================================================
        function createFloatingPanel() {
            if (document.getElementById("comfyui-panel")) return;
            const panel = document.createElement('div'); panel.id = "comfyui-panel";
            panel.style.left = CONFIG.ballState.x + 'px'; panel.style.top = CONFIG.ballState.y + 'px';
            const optimizationChecked = CONFIG.enablePromptOptimization ? 'checked' : '';
            const base64Checked = CONFIG.forceBase64 ? 'checked' : '';
            let imageSizeOptionsHtml = CHAT_API_IMAGE_SIZES.map(s => `<option value="${s.value}" ${CONFIG.chatApiImageSize === s.value ? 'selected' : ''}>${s.label}</option>`).join('');

            panel.innerHTML = `
            <style>
                #comfyui-panel{position:fixed;z-index:99999;font-family:Arial,sans-serif;transition:all .2s ease-out;user-select:none;touch-action:none;cursor:grab;box-shadow:0 4px 12px rgba(0,0,0,.3);border-radius:50%}
                .ball-header{width:50px;height:50px;background:#28a745;color:#fff;border-radius:50%;display:flex;justify-content:center;align-items:center;font-size:16px;font-weight:bold;box-shadow:0 2px 5px rgba(0,0,0,.2)}
                .panel-body{position:absolute;top:0;right:60px;background:#fff;border:1px solid #28a745;border-radius:8px;padding:15px;width:340px;max-height:85vh;overflow-y:auto;transform-origin:right center;transition:transform .3s ease,opacity .3s ease}
                .collapsed .panel-body{transform:scale(.1);opacity:0;pointer-events:none}
                #comfyui-body input, #comfyui-body select{box-sizing:border-box;width:100%;padding:4px;margin-top:2px;}
                #comfyui-body button{padding:4px 8px;font-size:12px;cursor:pointer;}
                #comfyui-body hr{border:0;border-top:1px solid #eee;margin:15px 0}
                #comfyui-body label{font-weight:bold;margin-top:8px;display:inline-block;}
                #comfyui-body small{color:#666;font-size:11px;display:block;}
                .api-settings-group { border-left: 3px solid #007bff; padding-left: 10px; margin-top: 10px; }
            </style>
            <div id="comfyui-ball" class="ball-header" title="API 设置">AI</div>
            <div id="comfyui-body" class="panel-body">
                <label for="api-provider-selector">图片API提供商</label>
                <select id="api-provider-selector">
                    <option value="chat_api" ${CONFIG.apiProvider === 'chat_api' ? 'selected' : ''}>通用 Chat API</option>
                    <option value="runninghub" ${CONFIG.apiProvider === 'runninghub' ? 'selected' : ''}>RunningHub API</option>
                </select>
                <hr>

                <div id="chat-api-settings" class="api-settings-group">
                    <div style="margin-bottom:8px;"><label>① Chat API (图片生成)</label></div>
                    <div style="margin-bottom:8px;">API 地址:<br><input id="chat-api-url" type="text" value="${CONFIG.chatApiUrl}" placeholder="https://tokencount.aigemini.org"></div>
                    <div style="margin-bottom:8px;">API Key:<br><input id="chat-api-key" type="password" value="${CONFIG.chatApiKey}" placeholder="sk-..."></div>
                    <div style="text-align:right;"><button id="fetch-chat-models">📥 拉取图片模型</button></div>
                    <div style="margin-top:8px;"><label style="font-weight:normal;display:flex;align-items:center;cursor:pointer;"><input type="checkbox" id="force-base64" ${base64Checked} style="width:auto;margin-right:8px;">强制Base64发送图片</label><small style="padding-left:22px;">解决 "Invalid image input" 错误</small></div>
                    <div style="margin-top:8px;"><label>图片尺寸:</label><select id="chat-api-image-size">${imageSizeOptionsHtml}</select></div>
                </div>

                <div id="runninghub-api-settings" class="api-settings-group">
                     <div style="margin-bottom:8px;"><label>① RunningHub API (图片生成)</label></div>
                     <div style="margin-bottom:8px;">WebApp ID:<br><input id="runninghub-webapp-id" type="text" value="${CONFIG.runningHubWebAppId}"></div>
                     <div style="margin-bottom:8px;">API Key:<br><input id="runninghub-api-key" type="password" value="${CONFIG.runningHubApiKey}"></div>
                     <div style="margin-bottom:8px;">出图尺寸 (Size):<br><input id="runninghub-size" type="text" value="${CONFIG.runningHubSize}" placeholder="例如: 2K"></div>
                     <div style="margin-bottom:8px;">宽高比 (Aspect Ratio):<br><input id="runninghub-aspect-ratio" type="text" value="${CONFIG.runningHubAspectRatio}" placeholder="例如: 分辨率9:16"></div>
                </div>

                <hr>
                <div style="margin-bottom:8px;"><label style="display:flex; align-items:center; cursor:pointer;"><input type="checkbox" id="enable-prompt-optimization" ${optimizationChecked} style="width:auto; margin-right:8px;">启用AI提示词优化</label></div>
                <div id="optimization-section" style="border-left: 2px solid #6c757d; padding-left: 10px; margin-left: 5px;">
                    <label>② 提示词优化 API (文本)</label>
                    <div style="margin-bottom:8px;">
                        <label>优化级别:</label>
                        <select id="optimization-level-selector" style="width:100%;">
                            <option value="light" ${CONFIG.optimizationLevel === 'light' ? 'selected' : ''}>轻度 - 仅翻译，保留原意</option>
                            <option value="medium" ${CONFIG.optimizationLevel === 'medium' ? 'selected' : ''}>中度 - 平衡翻译与安全</option>
                            <option value="heavy" ${CONFIG.optimizationLevel === 'heavy' ? 'selected' : ''}>重度 - 强调安全与艺术</option>
                        </select>
                        <small style="color:#666;display:block;margin-top:3px;">
                            轻度：保留细节，适合精确控制<br>
                            中度：平衡效果，推荐使用<br>
                            重度：最安全，但可能改变较多
                        </small>
                    </div>
                    <div style="margin-bottom:8px;">API 地址:<br><input id="text-api-url" type="text" value="${CONFIG.textApiUrl}" placeholder="https://api.openai.com"></div>
                    <div style="margin-bottom:8px;">API Key:<br><input id="text-api-key" type="password" value="${CONFIG.textApiKey}" placeholder="sk-..."></div>
                    <div style="margin-bottom:8px;">优化用文本模型:<br><select id="optimization-model-selector"></select></div>
                    <div style="text-align:right;"><button id="fetch-text-models">📥 拉取文本模型</button></div>
                </div>

                <hr>
                <label>角色配置</label><select id="comfy-char-selector"></select>
                <div style="display:flex;gap:5px;margin:8px 0;"><button id="comfy-add-char">＋ 添加</button><button id="comfy-import-all-chars">📋 批量导入</button><button id="comfy-delete-char">－ 删除</button></div>
                <div id="char-model-selector-wrapper">选择图片模型:<br><select id="image-model-selector"></select></div>
                <div>角色图片地址:<br><input id="char-image-url" type="text" placeholder="https://example.com/character.jpg"></div>
                <button id="comfyui-save">💾 保存全部设置</button>
                <hr>
                <div id="comfyui-status" style="font-size:12px;color:#555;text-align:center;"></div>
            </div>`;

            document.body.appendChild(panel);
            if (CONFIG.ballState.collapsed) panel.classList.add('collapsed');
            bindPanelEvents();
            updateUIVisibility();
            updateChatModelSelector();
            updateTextModelSelector();
            updateCharSelector();
            updateStatusText();
        }

        function updateUIVisibility() {
            const provider = document.getElementById('api-provider-selector').value;
            document.getElementById('chat-api-settings').style.display = provider === 'chat_api' ? 'block' : 'none';
            document.getElementById('runninghub-api-settings').style.display = provider === 'runninghub' ? 'block' : 'none';
            document.getElementById('char-model-selector-wrapper').style.display = provider === 'chat_api' ? 'block' : 'none';
            document.getElementById('optimization-section').style.display = document.getElementById('enable-prompt-optimization').checked ? 'block' : 'none';
        }

        function updateStatusText() { const s = document.getElementById('comfyui-status'); if(s) s.innerHTML = `已配置 ${Object.keys(CONFIG.characterConfigs).length} 角色 · ${Object.keys(localStorage).filter(k=>k.startsWith(CACHE_PREFIX)).length} 缓存`; }

        function bindPanelEvents() {
            const panel = document.getElementById('comfyui-panel'); const ball = document.getElementById('comfyui-ball'); let isDragging = false, startX, startY, offsetX, offsetY; const startDrag = (e) => { isDragging = true; e.preventDefault(); const c = e.touches ? e.touches[0] : e; offsetX = c.clientX - panel.offsetLeft; offsetY = c.clientY - panel.offsetTop; startX = c.clientX; startY = c.clientY; panel.style.transition = 'none'; }; const onDrag = (e) => { if (!isDragging) return; const c = e.touches ? e.touches[0] : e; panel.style.left = (c.clientX - offsetX) + 'px'; panel.style.top = (c.clientY - offsetY) + 'px'; }; const endDrag = (e) => { if (!isDragging) return; isDragging = false; panel.style.transition = 'all 0.2s ease-out'; const c = e.changedTouches ? e.changedTouches[0] : e; if (Math.abs(c.clientX - startX) < 5 && Math.abs(c.clientY - startY) < 5) { panel.classList.toggle('collapsed'); CONFIG.ballState.collapsed = panel.classList.contains('collapsed'); } CONFIG.ballState.x = panel.offsetLeft; CONFIG.ballState.y = panel.offsetTop; saveConfig(); }; ball.addEventListener('mousedown', startDrag); document.addEventListener('mousemove', onDrag); document.addEventListener('mouseup', endDrag);

            document.getElementById('api-provider-selector').addEventListener('change', updateUIVisibility);
            document.getElementById('enable-prompt-optimization').addEventListener('change', updateUIVisibility);

            document.getElementById('comfyui-save').addEventListener('click', () => {
                CONFIG.apiProvider = document.getElementById('api-provider-selector').value;
                CONFIG.enablePromptOptimization = document.getElementById('enable-prompt-optimization').checked;
                CONFIG.optimizationLevel = document.getElementById('optimization-level-selector').value; // 新增：保存优化级别
                CONFIG.optimizationModel = document.getElementById('optimization-model-selector').value;
                CONFIG.textApiUrl = document.getElementById('text-api-url').value.trim();
                CONFIG.textApiKey = document.getElementById('text-api-key').value.trim();
                CONFIG.chatApiUrl = document.getElementById('chat-api-url').value.trim();
                CONFIG.chatApiKey = document.getElementById('chat-api-key').value.trim();
                CONFIG.forceBase64 = document.getElementById('force-base64').checked;
                CONFIG.chatApiImageSize = document.getElementById('chat-api-image-size').value;
                CONFIG.runningHubWebAppId = document.getElementById('runninghub-webapp-id').value.trim();
                CONFIG.runningHubApiKey = document.getElementById('runninghub-api-key').value.trim();
                CONFIG.runningHubSize = document.getElementById('runninghub-size').value.trim();
                CONFIG.runningHubAspectRatio = document.getElementById('runninghub-aspect-ratio').value.trim();

                const selectedChar = document.getElementById('comfy-char-selector').value;
                if (selectedChar) {
                    const model = document.getElementById('image-model-selector').value;
                    const imageUrl = document.getElementById('char-image-url').value.trim();
                    if (!imageUrl) { if (!confirm(`角色 "${selectedChar}" 的图片地址为空！\n是否仍要保存？`)) return; }
                    CONFIG.characterConfigs[selectedChar] = { model, imageUrl };
                }
                saveConfig();
                updateCharSelector(selectedChar);
                const statusDiv = document.getElementById('comfyui-status'); statusDiv.textContent = `✅ 设置已保存`;
                setTimeout(updateStatusText, 2000);
            });

            async function handleFetchModels(type) {
                const btnId = `fetch-${type}-models`; const btn = document.getElementById(btnId); btn.textContent = '⏳ 拉取中...'; btn.disabled = true;
                const apiUrl = document.getElementById(`${type}-api-url`).value.trim(); const apiKey = document.getElementById(`${type}-api-key`).value.trim();
                try {
                    if (!apiUrl || !apiKey) throw new Error('请先填写API地址和Key');
                    const models = await fetchModels(apiUrl, apiKey);
                    if (type === 'chat') { CONFIG.availableChatModels = models; updateChatModelSelector(); }
                    else { CONFIG.availableTextModels = models; updateTextModelSelector(); }
                    saveConfig(); alert(`✅ 成功拉取 ${models.length} 个模型！`);
                } catch (error) { alert(`❌ 拉取模型失败:\n${error.message}`); }
                finally { btn.textContent = `📥 拉取${type === 'chat' ? '图片' : '文本'}模型`; btn.disabled = false; }
            }
            document.getElementById('fetch-chat-models').addEventListener('click', () => handleFetchModels('chat'));
            document.getElementById('fetch-text-models').addEventListener('click', () => handleFetchModels('text'));

            document.getElementById('comfy-char-selector').addEventListener('change', (e) => {
                const charName = e.target.value;
                if (charName && CONFIG.characterConfigs[charName]) {
                    const config = CONFIG.characterConfigs[charName];
                    document.getElementById('image-model-selector').value = config.model || '';
                    document.getElementById('char-image-url').value = config.imageUrl || '';
                } else {
                    document.getElementById('image-model-selector').value = '';
                    document.getElementById('char-image-url').value = '';
                }
            });
            document.getElementById('comfy-add-char').addEventListener('click', () => { const charName = prompt("请输入角色名称:"); if (charName?.trim()) { const trimmedName = charName.trim(); if (!CONFIG.characterConfigs[trimmedName]) { CONFIG.characterConfigs[trimmedName] = { model: '', imageUrl: '' }; updateCharSelector(trimmedName); } else { alert(`角色 "${trimmedName}" 已存在！`); } } });
            document.getElementById('comfy-import-all-chars').addEventListener('click', async () => { try { const charNames = await (async()=>{return new Promise((r,j)=>{const id='i'+Date.now();window.addEventListener('comfy_import_response',function h(e){if(e.detail.requestId===id){window.removeEventListener('comfy_import_response',h);e.detail.error?j(new Error(e.detail.error)):r(e.detail.payload)}});const s=document.createElement('script');s.textContent=`(async()=>{const p=[];if(window.state?.chats){Object.values(window.state.chats).filter(c=>!c.isGroup).forEach(c=>p.push(c.name))}window.dispatchEvent(new CustomEvent('comfy_import_response',{detail:{requestId:'${id}',payload:p,error:window.state?.chats?null:'EPhone状态未加载'}}))})();`;document.head.appendChild(s);s.remove()})})(); let c = 0; charNames.forEach(n => { if (!CONFIG.characterConfigs[n]) { CONFIG.characterConfigs[n] = { model: '', imageUrl: '' }; c++; } }); if (c > 0) { saveConfig(); updateCharSelector(charNames[0]); alert(`✅ 成功导入 ${c} 个新角色！`); } else { alert("所有角色已在配置中"); } } catch (e) { alert(`❌ 导入失败:\n${e.message}`); } });
            document.getElementById('comfy-delete-char').addEventListener('click', () => { const selectedChar = document.getElementById('comfy-char-selector').value; if (selectedChar && confirm(`确定删除角色 "${selectedChar}" 的配置吗？`)) { delete CONFIG.characterConfigs[selectedChar]; saveConfig(); updateCharSelector(); alert('✅ 已删除'); } });
        }
        function updateCharSelector(selectThisChar = null) { const s = document.getElementById('comfy-char-selector'); const c = selectThisChar || s.value; s.innerHTML = ''; const n = Object.keys(CONFIG.characterConfigs).sort(); if (n.length === 0) { s.add(new Option('-- 请添加角色 --', '')); document.getElementById('image-model-selector').innerHTML = '<option value="">-- 无角色 --</option>'; document.getElementById('char-image-url').value = ''; return; } n.forEach(name => s.add(new Option(name, name))); if (c && CONFIG.characterConfigs[c]) { s.value = c; } else if (n.length > 0) { s.value = n[0]; } s.dispatchEvent(new Event('change')); }
        function updateModelSelector(selectorId, models, currentSelection) { const s = document.getElementById(selectorId); s.innerHTML = ''; if (models.length === 0) { s.add(new Option('-- 请先拉取模型列表 --', '')); return; } models.forEach(m => s.add(new Option(m, m))); if (currentSelection && models.includes(currentSelection)) { s.value = currentSelection; } }
        const updateChatModelSelector = () => updateModelSelector('image-model-selector', CONFIG.availableChatModels, document.getElementById('comfy-char-selector').value ? CONFIG.characterConfigs[document.getElementById('comfy-char-selector').value]?.model : null);
        const updateTextModelSelector = () => updateModelSelector('optimization-model-selector', CONFIG.availableTextModels, CONFIG.optimizationModel);

        // ======================================================
        // 启动器与菜单
        // ======================================================
        function startPolling() {
            setInterval(() => {
                document.querySelectorAll(IMAGE_SELECTOR).forEach(img => {
                    if (!img.dataset.processed) processImage(img);
                });
                document.querySelectorAll('img[data-processed="true"]').forEach(img => {
                    if (img.dataset.uiAttached !== 'true') {
                        const chatName = getCharacterNameForImage(img);
                        if (chatName) attachRegenerateUI(img, chatName);
                    }
                });
            }, 1000);
        }
        console.log(`[配置信息] 当前API: ${CONFIG.apiProvider}, AI优化: ${CONFIG.enablePromptOptimization ? `开启 (${CONFIG.optimizationModel})` : '关闭'}`);

        createFloatingPanel();
        startPolling();
        GM_registerMenuCommand("⚙️ 打开/关闭设置面板", () => { const panel = document.getElementById("comfyui-panel"); panel?.classList.toggle('collapsed'); CONFIG.ballState.collapsed = panel.classList.contains('collapsed'); saveConfig(); });
        GM_registerMenuCommand("🖼️ 查看图片缓存", openCacheViewer);
        GM_registerMenuCommand("🗑️ 清除所有图片缓存", () => { if (confirm('确定要清除所有缓存的图片吗？此操作不可撤销。')) { let c = 0; Object.keys(localStorage).forEach(k => { if (k.startsWith(CACHE_PREFIX)) { localStorage.removeItem(k); c++; } }); alert(`✅ 已清除 ${c} 张缓存图片`); updateStatusText(); } });
        GM_registerMenuCommand("📋 导出配置", () => { const exportData = { version: '10.2', ...CONFIG, ballState: undefined, availableChatModels: undefined, availableTextModels: undefined, exportTime: new Date().toISOString() }; const dataStr = JSON.stringify(exportData, null, 2); const blob = new Blob([dataStr], { type: 'application/json' }); const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `ephone_api_config_${Date.now()}.json`; a.click(); URL.revokeObjectURL(a.href); });
        GM_registerMenuCommand("📥 导入配置", () => { const input = document.createElement('input'); input.type = 'file'; input.accept = 'application/json'; input.onchange = (e) => { const file = e.target.files[0]; if (!file) return; const reader = new FileReader(); reader.onload = (event) => { try { const importData = JSON.parse(event.target.result); if (!importData.version || !importData.characterConfigs) throw new Error('配置文件格式不正确'); if (confirm(`确定要导入配置吗？\n\n版本: ${importData.version}\n角色数: ${Object.keys(importData.characterConfigs).length}\n\n当前配置将被覆盖！`)) { Object.assign(CONFIG, importData); saveConfig(); location.reload(); alert('✅ 配置导入成功！页面将刷新。'); } } catch (error) { alert(`❌ 导入失败:\n${error.message}`); } }; reader.readAsText(file); }; input.click(); });
    }

    if (document.readyState === 'complete' || document.readyState === 'interactive') {
        main();
    } else {
        window.addEventListener('DOMContentLoaded', main);
    }
})();