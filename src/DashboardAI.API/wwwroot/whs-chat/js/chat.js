// Load member data from localStorage
const _jmember = (() => {
    try { return JSON.parse(localStorage.getItem('jmemberData') || '{}'); } catch(e) { return {}; }
})();

// Configuration
//  apiUrl: 'https://beta.whsmonitor.com.au/affinda/api/chat-template',
//  apiUrl: 'http://localhost:48110/api/chat-template',
const CONFIG = {
    apiUrl: 'https://beta.whsmonitor.com.au/affinda/api/chat-template',
    storeId: _jmember.StoreID || 5651,
    userId: _jmember.MemberID || 20707,
    firstName: _jmember.FirstName || 'User',
    userName: _jmember.UserName || 'User',
    elevenlabsApiKey: '',
    elevenlabsVoiceId: 'EXAVITQu4vr4xnSDxMaL', // Default voice (Sarah)
    openaiApiKey: '',
    googleMapsApiKey: '', // Google Maps API key for location fields,
    // Known profile facts from localStorage — sent with every message so AI never asks for things it already knows
    userProfile: {
        FullName:      [_jmember.FirstName, _jmember.Surname].filter(Boolean).join(' ') || null,
        Organisation:  _jmember.Organisation || null,
        StoreName:     _jmember.StoreName    || null,
        Industry:      _jmember.IndustryList || null,
        Email:         _jmember.EmailAddress || null,
        CompanySize:   _jmember.CompanySize  || null,
        Domain:        _jmember.Domain       || null
    }
};

// State
let state = {
    sessionStarted: false,
    regOthId: null,
    internalNo: '',
    templateName: '',
    moduleName: '',
    conversationHistory: [],
    extractedFieldsMap: new Map(),
    completionPercentage: 0,
    initialMessage: '',
    awaitingTemplateSelection: false,
    availableTemplates: [],
    currentFieldID: null,        // Current field being asked
    currentFieldType: null,      // e.g., "10013" for file upload
    lastMapData: null,           // Last confirmed map data (for Yes/No confirmations)
    voiceMode: false,
    sttEngine: 'vad',  // 'webspeech' | 'vad'
    isListening: false,
    isSpeaking: false,
    isProcessing: false,
    useElevenLabs: false,
    lastAiMessage: '',
    speakingEl: null,
    pendingResponse: null,   // queued AI response waiting for thinking phrase to finish
    sessionCompleted: false, // true once the session has been formally completed
    sessionCost: { totalUSD: 0 }, // accumulated AI spend
    smartFillTriggered: false, // true once Smart Fill has run for this session
    _initialMessageBubbleShown: false // true when dashboard-intent path already added the user bubble
};

// Voice APIs
let recognition = null;
let micVAD = null;           // @ricky0123/vad-web instance
let synthesis = window.speechSynthesis;
let finalTranscript = '';
let ttsGeneration = 0;       // incremented on every new TTS — stale callbacks self-abort

// OpenAI pricing (all calls — client-side and server-side)
const PRICING = {
    'gpt-4o':      { input: 2.50  / 1_000_000, output: 10.00 / 1_000_000 },
    'gpt-4o-mini': { input: 0.15  / 1_000_000, output: 0.60  / 1_000_000 },
    'whisper-1':   { perSecond: 0.006 / 60 }
};

function trackCost(model, usage) {
    if (!usage) return;
    const p = PRICING[model];
    if (!p || p.perSecond !== undefined) return;
    state.sessionCost.totalUSD += (usage.prompt_tokens || 0) * p.input
                                + (usage.completion_tokens || 0) * p.output;
    updateCostDisplay();
}

function trackServerCost(tokenUsageArray) {
    if (!Array.isArray(tokenUsageArray)) return;
    tokenUsageArray.forEach(u => {
        if (!u) return;
        const p = PRICING[u.model] || PRICING['gpt-4o'];
        if (!p || p.perSecond !== undefined) return;
        state.sessionCost.totalUSD += (u.promptTokens || 0) * p.input
                                    + (u.completionTokens || 0) * p.output;
    });
    updateCostDisplay();
}

function trackWhisper(durationSeconds) {
    state.sessionCost.totalUSD += durationSeconds * PRICING['whisper-1'].perSecond;
    updateCostDisplay();
}

function updateCostDisplay() {
    const el = document.getElementById('panelCost');
    if (el) el.textContent = `$${state.sessionCost.totalUSD.toFixed(4)}`;
}

// Detect user's date format (MM/dd/yyyy vs dd/MM/yyyy)
function getUserDateFormat() {
    try {
        // Test with March 1, 2026 (month=2 is March in JS Date, which is the 3rd month)
        const testDate = new Date(2026, 2, 1); // March 1, 2026
        const formatted = testDate.toLocaleDateString();
        
        // Check if "03" appears before "01" (MM/dd/yyyy) or after (dd/MM/yyyy)
        const index03 = formatted.indexOf('03');
        const index01 = formatted.indexOf('01');
        
        if (index03 < index01) {
            return 'MM/dd/yyyy'; // US format
        } else {
            return 'dd/MM/yyyy'; // AU/UK format
        }
    } catch {
        return 'dd/MM/yyyy'; // Default to AU/UK
    }
}

// Initialize
document.addEventListener('DOMContentLoaded', () => {
    setGreeting();
    initializeQuill();
    initVoiceRecognition();

    // Restore AI Memory confidence preference
    const savedConfidence = localStorage.getItem('memoryConfidence');
    if (savedConfidence) {
        const sel = document.getElementById('memoryConfidence');
        if (sel) sel.value = savedConfidence;
    }

    // Restore Smart Fill toggle (default: enabled on first visit)
    const smartFillOn = localStorage.getItem('smartFill') !== 'false';
    const sfToggle = document.getElementById('smartFillToggle');
    if (sfToggle) {
        sfToggle.checked = smartFillOn;
        applySmartFillStyle(smartFillOn);
    }

    // Auto-resume if ?sessionId=XXXXX is in the URL
    const sessionIdParam = new URLSearchParams(window.location.search).get('sessionId');
    if (sessionIdParam && parseInt(sessionIdParam, 10) > 0) {
        resumeSession(parseInt(sessionIdParam, 10));
    }
});

function setGreeting() {
    const hour = new Date().getHours();
    let greeting = 'Good morning';

    if (hour >= 12 && hour < 17) {
        greeting = 'Good afternoon';
    } else if (hour >= 17) {
        greeting = 'Good evening';
    }

    document.getElementById('greeting').textContent = `${greeting}, ${CONFIG.firstName}`;
}

/**
 * Persist the user's AI memory confidence preference.
 * Called by the select#memoryConfidence onchange handler.
 */
function saveMemoryConfidence(value) {
    localStorage.setItem('memoryConfidence', value);
}

function saveSmartFill(enabled) {
    localStorage.setItem('smartFill', enabled ? 'true' : 'false');
    applySmartFillStyle(enabled);
}

function applySmartFillStyle(enabled) {
    const slider = document.getElementById('smartFillSlider');
    const knob   = document.getElementById('smartFillKnob');
    if (!slider || !knob) return;
    slider.style.background = enabled ? '#6366f1' : '#d1d5db';
    knob.style.transform    = enabled ? 'translateX(18px)' : 'translateX(0)';
}

/** Returns true when Smart Fill mode is active (defaults to enabled on first visit) */
function isSmartFillEnabled() {
    return localStorage.getItem('smartFill') !== 'false';
}

function autoResizeTextarea() {
    // No-op: Quill handles its own height
}

function initializeQuill() {
    const toolbarOptions = [
        ['bold', 'italic'],
        [{ list: 'bullet' }, { list: 'ordered' }]
    ];

    const sendBinding = {
        key: 'Enter',
        shiftKey: false,
        handler: function() {
            sendMessage();
            return false; // false = don't let Quill add a newline
        }
    };

    window.quillMain = new Quill('#messageInput', {
        theme: 'bubble',
        placeholder: 'What do you need help with? (e.g., I saw a hazard in the warehouse...)',
        modules: {
            toolbar: toolbarOptions,
            keyboard: { bindings: { send: sendBinding } }
        }
    });

    window.quillChat = new Quill('#chatMessageInput', {
        theme: 'bubble',
        placeholder: 'Type your message...',
        modules: {
            toolbar: toolbarOptions,
            keyboard: { bindings: { send: sendBinding } }
        }
    });
}

function handleMic() {
    if (!state.voiceMode) {
        startVoiceMode();
    } else {
        stopVoiceMode();
    }
}

function getActiveInput() {
    const mainContainer = document.getElementById('messageInput');
    const activeQuill = (mainContainer && mainContainer.offsetParent !== null)
        ? window.quillMain
        : window.quillChat;
    return {
        get value() {
            if (!activeQuill) return '';
            // getText() returns plain text — HTML is stripped automatically
            return activeQuill.getText().trim();
        },
        get htmlValue() {
            if (!activeQuill) return '';
            return activeQuill.root.innerHTML;
        },
        set value(v) {
            if (!activeQuill) return;
            activeQuill.setText(v || '');
        },
        style: { height: '' }, // no-op — Quill auto-sizes
        focus() { if (activeQuill) activeQuill.focus(); }
    };
}

// Disable/enable the chat Quill editor and update its placeholder
function setChatInputState(disabled, placeholderText) {
    if (window.quillChat) {
        window.quillChat.enable(!disabled);
        const editor = document.querySelector('#chatMessageInput .ql-editor');
        if (editor) editor.dataset.placeholder = placeholderText || '';
    }
}

// Clear both Quill editors (used on new session)
function clearAllInputs() {
    if (window.quillChat) window.quillChat.setText('');
    if (window.quillMain) window.quillMain.setText('');
}

function initVoiceRecognition() {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
        console.error('Speech recognition not supported in this browser');
        return;
    }
    // Store constructor for re-use
    window._SpeechRecognition = SpeechRecognition;
}

function createRecognitionInstance() {
    const SpeechRecognition = window._SpeechRecognition;
    if (!SpeechRecognition) return null;

    const rec = new SpeechRecognition();
    rec.continuous = false;       // stops naturally after end-of-speech
    rec.interimResults = true;    // show live text while speaking
    rec.lang = 'en-AU';
    rec.maxAlternatives = 1;

    rec.onstart = () => {
        state.isListening = true;
        finalTranscript = '';
        updateVoiceUI();
        showVoiceStatus('Listening... (speak now)');
    };

    rec.onresult = (event) => {
        let interimTranscript = '';
        for (let i = event.resultIndex; i < event.results.length; i++) {
            const transcript = event.results[i][0].transcript;
            if (event.results[i].isFinal) {
                finalTranscript += transcript;
            } else {
                interimTranscript = transcript;
            }
        }
        // Mirror live into the active input
        getActiveInput().value = (finalTranscript + interimTranscript).trim();
    };

    rec.onerror = (event) => {
        // Always reset listening state so onend can restart cleanly
        state.isListening = false;
        if (event.error === 'no-speech' || event.error === 'aborted') {
            return; // Expected — onend will restart
        }
        console.error('Speech recognition error:', event.error);
    };

    rec.onend = () => {
        state.isListening = false;
        updateVoiceUI();

        // Chrome bug: onend sometimes fires before the final onresult.
        // Fall back to whatever is visible in the input box.
        const capturedText = finalTranscript.trim() || getActiveInput().value.trim();

        if (capturedText) {
            // Ensure input has the text before sendMessage reads it
            getActiveInput().value = capturedText;
            finalTranscript = '';
            // Barge-in: if AI is speaking, cancel TTS and process the user's speech immediately
            if (state.isSpeaking) {
                synthesis.cancel();
                state.isSpeaking = false;
                updateVoiceUI();
            }
            sendMessage();
        } else if (state.voiceMode && !state.isSpeaking && !state.isProcessing) {
            // Silence / no speech — restart listening after short pause
            setTimeout(() => {
                if (state.voiceMode && !state.isSpeaking && !state.isProcessing) {
                    startListening();
                }
            }, 300);
        }
    };

    return rec;
}

async function startVoiceMode() {
    // Check for microphone permission first
    try {
        const stream = await navigator.mediaDevices.getUserMedia({
            audio: {
                echoCancellation: true,
                noiseSuppression: true,
                autoGainControl: true
            }
        });
        stream.getTracks().forEach(track => track.stop()); // Stop the stream, we just needed permission

        state.voiceMode = true;
        updateVoiceUI();
        showVoiceStatus('Voice mode activated - speak naturally');

        // Show TTS toggle
        document.getElementById('voiceControlsContainer').classList.add('show');

        // Start listening — VAD needs async init, Web Speech uses a timeout
        if (state.sttEngine === 'vad') {
            await initAndStartVAD();
        } else {
            setTimeout(() => startListening(), 500);
        }
    } catch (error) {
        console.error('Microphone permission denied:', error);
        alert('Please allow microphone access to use voice mode.\n\nTip: For the permission to persist, open this page through a local web server (http://localhost) instead of as a file.');
        return;
    }
}

function stopVoiceMode() {
    state.voiceMode = false;
    state.isListening = false;
    state.isSpeaking = false;

    if (state.sttEngine === 'vad') {
        if (micVAD) { try { micVAD.pause(); } catch(e) {} }
    } else {
        if (recognition) { try { recognition.abort(); } catch(e) {} }
    }

    // Stop any ongoing speech
    synthesis.cancel();

    // Hide TTS toggle
    document.getElementById('voiceControlsContainer').classList.remove('show');

    updateVoiceUI();
    hideVoiceStatus();
}

function startListening() {
    if (!state.voiceMode || state.isListening || state.isSpeaking || state.isProcessing) return;

    // VAD path — VAD stream is always open; just resume it
    if (state.sttEngine === 'vad') {
        if (micVAD) {
            micVAD.start();
            state.isListening = true;
            updateVoiceUI();
            showVoiceStatus('Listening...');
        }
        return;
    }

    // Web Speech API path
    if (!window._SpeechRecognition) return;

    // Create a fresh instance each time — prevents Chrome's stale-object bug
    recognition = createRecognitionInstance();
    if (!recognition) return;

    try {
        recognition.start();
    } catch (e) {
        console.error('Error starting recognition:', e);
        state.isListening = false;
    }
}

function playChime() {
    return new Promise(resolve => {
        try {
            const ctx = new (window.AudioContext || window.webkitAudioContext)();
            // Soft 3-note descending bell arpeggio — B5 → G5 → E5 (warm, friendly, not queue-like)
            [[987.77, 0], [783.99, 0.22], [659.25, 0.42]].forEach(([freq, offset]) => {
                const osc = ctx.createOscillator();
                const gain = ctx.createGain();
                osc.connect(gain);
                gain.connect(ctx.destination);
                osc.type = 'triangle';  // warmer tone than sine
                osc.frequency.value = freq;
                gain.gain.setValueAtTime(0, ctx.currentTime + offset);
                gain.gain.linearRampToValueAtTime(0.15, ctx.currentTime + offset + 0.015);
                gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + offset + 0.55);
                osc.start(ctx.currentTime + offset);
                osc.stop(ctx.currentTime + offset + 0.55);
            });
            setTimeout(resolve, 1000);
        } catch(e) {
            resolve(); // AudioContext not available — skip
        }
    });
}

async function speakHandoff() {
    if (!state.voiceMode || state.isProcessing) {
        if (state.voiceMode && !state.isProcessing) startListening();
        return;
    }
    await playChime();
    if (state.voiceMode) startListening();
}

function speakPhrase(text) {
    // Speak a phrase — route through selected engine, then open mic (not speakHandoff)
    const gen = ++ttsGeneration; // capture generation for this TTS slot
    const onComplete = () => {
        if (gen !== ttsGeneration) return; // a newer TTS has taken over — do nothing
        state.isSpeaking = false;
        // If the API response arrived while we were speaking, play it now rather than opening the mic
        if (state.pendingResponse) {
            const pending = state.pendingResponse;
            state.pendingResponse = null;
            speakText(pending);
            return;
        }
        if (state.voiceMode) setTimeout(() => startListening(), 300);
    };

    // Silence VAD before audio plays — mic only reopens after beep via startListening()
    if (state.sttEngine === 'vad' && micVAD) {
        try { micVAD.pause(); } catch(e) {}
    }
    synthesis.cancel();
    state.isSpeaking = true;
    updateVoiceUI();

    if (state.useElevenLabs && CONFIG.elevenlabsApiKey) {
        speakWithElevenLabs(text, gen, onComplete);
    } else {
        speakWithBrowserPhrase(text, gen, onComplete);
    }
}

function speakWithBrowserPhrase(text, gen, onComplete) {
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = 'en-AU';
    utterance.rate = 1.0;
    utterance.pitch = 1.0;
    utterance.volume = 1.0;

    const t = setTimeout(() => {
        if (gen !== ttsGeneration) return;
        synthesis.cancel();
        updateVoiceUI();
        onComplete?.();
    }, 8000);

    utterance.onend = () => {
        clearTimeout(t);
        if (gen !== ttsGeneration) return; // superseded by newer TTS
        updateVoiceUI();
        onComplete?.();
    };
    utterance.onerror = () => {
        clearTimeout(t);
        if (gen !== ttsGeneration) return; // cancelled by speakText() — ignore
        updateVoiceUI();
        onComplete?.();
    };

    synthesis.speak(utterance);
}

async function speakThinking(context, userMessage) {
    if (!state.voiceMode) return;

    const fallbacks = {
        first: ["One moment.", "Got it, just a second.", "On it.", "Sure thing.", "Right, give me a sec."],
        template: ["Got it, one moment.", "Sure thing.", "On it.", "Just a second.", "Right away."],
        chat: ["One moment.", "Got it.", "Sure thing.", "Just a sec.", "On it.", "Right, one moment."]
    };

    const list = fallbacks[context] || fallbacks.chat;
    const fallback = list[Math.floor(Math.random() * list.length)];

    if (!CONFIG.openaiApiKey) {
        speakPhrase(fallback);
        return;
    }

    try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 3000); // 3s max — must be fast

        const systemPrompt = `You are a voice assistant. The user just sent a message and you are about to look up the answer.
Reply with ONE very short filler phrase (2-5 words max) that you would say while processing — like "Got it.", "One moment.", "Sure thing.", "On it.", "Just a sec."
Do NOT start an answer. Do NOT repeat the user's question. No quotation marks. Just the brief filler phrase.`;

        const userContext = userMessage
            ? `The user said: "${userMessage.substring(0, 120)}"`
            : `Context: ${context}`;

        const res = await fetch('https://api.openai.com/v1/chat/completions', {
            method: 'POST',
            signal: controller.signal,
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${CONFIG.openaiApiKey}`
            },
            body: JSON.stringify({
                model: 'gpt-4o-mini',
                max_tokens: 25,
                temperature: 0.9,
                messages: [
                    { role: 'system', content: systemPrompt },
                    { role: 'user', content: userContext }
                ]
            })
        });

        clearTimeout(timeout);

        if (res.ok) {
            const data = await res.json();
            trackCost('gpt-4o-mini', data.usage);
            const phrase = data.choices?.[0]?.message?.content?.trim();
            if (phrase) {
                speakPhrase(phrase);
                return;
            }
        }
    } catch (e) {
        // Timeout or network error — fall through to fallback
    }

    speakPhrase(fallback);
}

function speakText(text) {
    if (!state.voiceMode) return;

    // If a thinking phrase is still playing, queue the response and let it finish naturally
    if (state.isSpeaking) {
        state.pendingResponse = text;
        return;
    }
    state.pendingResponse = null; // clear any stale queue

    const gen = ++ttsGeneration; // capture generation for this TTS slot
    const onComplete = () => {
        if (gen !== ttsGeneration) return;
        state.isSpeaking = false;
    };

    // Stop any active capture — prevents AI hearing itself
    if (state.sttEngine === 'vad') {
        if (micVAD) { try { micVAD.pause(); } catch(e) {} }
        state.isListening = false;
    } else {
        if (recognition) { try { recognition.abort(); } catch(e) {} }
    }

    // Cancel any ongoing speech (e.g. thinking phrase)
    synthesis.cancel();

    // Clear previous speaking highlight
    if (state.speakingEl) {
        state.speakingEl.classList.remove('speaking');
        state.speakingEl = null;
    }

    // Highlight + scroll to the message being spoken
    const messages = document.querySelectorAll('.message.assistant');
    const lastMsg = messages[messages.length - 1];
    if (lastMsg) {
        lastMsg.classList.add('speaking');
        state.speakingEl = lastMsg;
        lastMsg.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }

    state.isSpeaking = true;
    updateVoiceUI();
    showVoiceStatus('AI Speaking...');

    if (state.useElevenLabs && CONFIG.elevenlabsApiKey) {
        speakWithElevenLabs(text, gen, () => {
            if (state.speakingEl) { state.speakingEl.classList.remove('speaking'); state.speakingEl = null; }
            if (gen === ttsGeneration) speakHandoff();
        });
    } else {
        speakWithBrowser(text, gen, () => {
            if (state.speakingEl) { state.speakingEl.classList.remove('speaking'); state.speakingEl = null; }
            if (gen === ttsGeneration) speakHandoff();
        });
    }
}

function speakWithBrowser(text, gen, onComplete) {
    // Trim to 300 chars to avoid Chrome's long-text stall bug
    const maxChars = 300;
    const trimmedText = text.length > maxChars
        ? text.substring(0, text.lastIndexOf(' ', maxChars)) + '...'
        : text;

    const utterance = new SpeechSynthesisUtterance(trimmedText);
    utterance.lang = 'en-AU';
    utterance.rate = 1.0;
    utterance.pitch = 1.0;
    utterance.volume = 1.0;

    // Hard timeout: if onend never fires (Chrome stall), force-unlock after 15s
    const synthTimeout = setTimeout(() => {
        if (gen !== ttsGeneration) return;
        synthesis.cancel();
        state.isSpeaking = false;
        updateVoiceUI();
        if (state.voiceMode && !state.isProcessing) setTimeout(() => startListening(), 500);
    }, 15000);

    utterance.onend = () => {
        clearTimeout(synthTimeout);
        if (gen !== ttsGeneration) return;
        state.isSpeaking = false;
        updateVoiceUI();
        onComplete?.();
    };

    utterance.onerror = (event) => {
        clearTimeout(synthTimeout);
        if (gen !== ttsGeneration) return; // cancelled by a newer TTS — ignore
        if (event.error !== 'canceled' && event.error !== 'interrupted') {
            console.error('Speech synthesis error:', event.error);
        }
        state.isSpeaking = false;
        updateVoiceUI();
        onComplete?.();
    };

    synthesis.speak(utterance);
}

async function speakWithElevenLabs(text, gen, onComplete) {
    try {
        const controller = new AbortController();
        const fetchTimeout = setTimeout(() => controller.abort(), 10000); // 10s timeout

        const response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${CONFIG.elevenlabsVoiceId}`, {
            method: 'POST',
            signal: controller.signal,
            headers: {
                'Accept': 'audio/mpeg',
                'Content-Type': 'application/json',
                'xi-api-key': CONFIG.elevenlabsApiKey
            },
            body: JSON.stringify({
                text: text,
                model_id: 'eleven_turbo_v2_5',
                voice_settings: {
                    stability: 0.5,
                    similarity_boost: 0.75
                }
            })
        });
        clearTimeout(fetchTimeout);

        if (response.status === 401 || response.status === 403) {
            const errData = await response.json().catch(() => ({}));
            console.warn('ElevenLabs permission error — switching to browser TTS:', errData?.detail?.message || response.status);
            state.useElevenLabs = false;
            document.getElementById('ttsSelect').value = 'browser';
            speakWithBrowser(text, onComplete);
            return;
        }

        if (!response.ok) {
            throw new Error(`ElevenLabs API error: ${response.status}`);
        }

        const audioBlob = await response.blob();
        const audioUrl = URL.createObjectURL(audioBlob);
        const audio = new Audio(audioUrl);

        audio.onended = () => {
            URL.revokeObjectURL(audioUrl);
            if (gen !== ttsGeneration) return;
            state.isSpeaking = false;
            updateVoiceUI();
            onComplete?.();
        };

        audio.onerror = (event) => {
            console.error('Audio playback error:', event);
            URL.revokeObjectURL(audioUrl);
            if (gen !== ttsGeneration) return;
            state.isSpeaking = false;
            updateVoiceUI();
            onComplete?.();
        };

        await audio.play();
    } catch (error) {
        console.error('ElevenLabs TTS error:', error);
        speakWithBrowser(text, gen, onComplete);
    }
}

function onSTTChange(value) {
    // Stop voice mode before switching engines
    if (state.voiceMode) stopVoiceMode();
    // Destroy existing VAD instance so it's recreated fresh on next activation
    if (micVAD) {
        try { micVAD.pause(); } catch(e) {}
        micVAD = null;
    }
    state.sttEngine = value;
}

async function initAndStartVAD() {
    if (!window.vad) {
        alert('VAD library failed to load. Check your internet connection or switch to Web Speech API.');
        stopVoiceMode();
        return;
    }
    // Reuse existing instance if available
    if (micVAD) {
        micVAD.start();
        state.isListening = true;
        updateVoiceUI();
        showVoiceStatus('Listening...');
        return;
    }
    try {
        showVoiceStatus('Initializing VAD model...');
        micVAD = await vad.MicVAD.new({
            onSpeechStart: () => {
                if (!state.isSpeaking) {
                    state.isListening = true;
                    updateVoiceUI();
                    showVoiceStatus('Listening...');
                }
            },
            onSpeechEnd: async (audio) => {
                if (!state.voiceMode || state.isSpeaking || state.isProcessing) return;
                // Immediately silence the mic — don't let VAD capture anything
                // (transcription, API response, TTS) until after the beep
                micVAD.pause();
                state.isListening = false;
                updateVoiceUI();
                showVoiceStatus('Transcribing...');
                const text = await transcribeWithWhisper(audio);
                if (text) {
                    getActiveInput().value = text;
                    if (state.isSpeaking) {
                        synthesis.cancel();
                        state.isSpeaking = false;
                        updateVoiceUI();
                    }
                    sendMessage();
                } else if (state.voiceMode && !state.isSpeaking && !state.isProcessing) {
                    // Empty transcription (silence) — just keep listening
                    state.isListening = true;
                    updateVoiceUI();
                    showVoiceStatus('Listening...');
                }
            },
            onnxWASMBasePath: 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.22.0/dist/',
            baseAssetPath: 'https://cdn.jsdelivr.net/npm/@ricky0123/vad-web@0.0.29/dist/',
        });
        micVAD.start();
        state.isListening = true;
        updateVoiceUI();
        showVoiceStatus('Listening...');
    } catch (e) {
        console.error('VAD init error:', e);
        alert('Failed to initialize VAD: ' + e.message);
        stopVoiceMode();
    }
}

async function transcribeWithWhisper(audioFloat32) {
    try {
        // Track Whisper cost by audio duration (16 kHz mono)
        const durationSec = audioFloat32.length / 16000;
        trackWhisper(durationSec);
        const wavBlob = float32ToWav(audioFloat32);
        const formData = new FormData();
        formData.append('file', wavBlob, 'audio.wav');
        formData.append('model', 'whisper-1');
        formData.append('language', 'en');
        const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${CONFIG.openaiApiKey}` },
            body: formData
        });
        if (!response.ok) throw new Error(`Whisper API error: ${response.status}`);
        const data = await response.json();
        return data.text?.trim() || '';
    } catch (error) {
        console.error('Whisper transcription error:', error);
        return '';
    }
}

function float32ToWav(float32Array, sampleRate = 16000) {
    const buffer = new ArrayBuffer(44 + float32Array.length * 2);
    const view = new DataView(buffer);
    const writeString = (offset, str) => {
        for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
    };
    writeString(0, 'RIFF');
    view.setUint32(4, 36 + float32Array.length * 2, true);
    writeString(8, 'WAVE');
    writeString(12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);   // PCM format
    view.setUint16(22, 1, true);   // mono
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * 2, true);
    view.setUint16(32, 2, true);
    view.setUint16(34, 16, true);  // 16-bit
    writeString(36, 'data');
    view.setUint32(40, float32Array.length * 2, true);
    let offset = 44;
    for (let i = 0; i < float32Array.length; i++) {
        const s = Math.max(-1, Math.min(1, float32Array[i]));
        view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
        offset += 2;
    }
    return new Blob([buffer], { type: 'audio/wav' });
}

function onTTSChange(value) {
    if (value.startsWith('el:')) {
        if (!CONFIG.elevenlabsApiKey) {
            alert('Please add your ElevenLabs API key in the CONFIG section.\n\nGet your API key at: https://elevenlabs.io');
            document.getElementById('ttsSelect').value = 'browser';
            state.useElevenLabs = false;
            return;
        }
        state.useElevenLabs = true;
        CONFIG.elevenlabsVoiceId = value.substring(3);
    } else {
        state.useElevenLabs = false;
    }
}

function updateVoiceUI() {
    const micBtn = document.querySelectorAll('.mic-btn');

    micBtn.forEach(btn => {
        btn.classList.remove('active', 'listening');

        if (state.voiceMode) {
            if (state.isSpeaking) {
                btn.classList.add('active');
            } else if (state.isListening) {
                btn.classList.add('listening');
            } else {
                btn.classList.add('active');
            }
        }
    });
}

function showVoiceStatus(message) {
    const statusDiv = document.getElementById('voiceStatus');
    const statusText = document.getElementById('voiceStatusText');

    statusText.textContent = message;
    statusDiv.classList.add('show');

    if (state.isListening) {
        statusDiv.classList.add('listening');
        statusDiv.classList.remove('speaking');
    } else if (state.isSpeaking) {
        statusDiv.classList.add('speaking');
        statusDiv.classList.remove('listening');
    } else {
        statusDiv.classList.remove('listening', 'speaking');
    }
}

function hideVoiceStatus() {
    const statusDiv = document.getElementById('voiceStatus');
    statusDiv.classList.remove('show', 'listening', 'speaking');
}

function getFormUrl() {
    if (!state.regOthId) return null;
    // Check both the specific template name and the module name for 'incident'
    const haystack = ((state.templateName || '') + ' ' + (state.moduleName || '')).toLowerCase();
    const g = haystack.includes('incident') ? 'INCIDENT' : '';
    return `https://beta.whsmonitor.com.au/App/RiskAssessor/ChecklistV2.aspx?regothId=${state.regOthId}&IsEdit=1&g=${g}`;
}

/**
 * Uses OpenAI (gpt-4o-mini) to decide whether the user's message is asking
 * to view / open / see the form. If yes, opens the form URL in a new tab,
 * adds an AI reply, speaks it in voice mode, and returns true so the
 * normal chat pipeline is skipped.
 */
async function checkAndHandleFormIntent(message) {
    if (!state.regOthId || !CONFIG.openaiApiKey) return false;
    // Only run intent check on short, directive messages — never on form field answers or pastes
    if (message.length > 80) return false;

    try {
        const controller = new AbortController();
        const t = setTimeout(() => controller.abort(), 4000);

        const res = await fetch('https://api.openai.com/v1/chat/completions', {
            method: 'POST',
            signal: controller.signal,
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${CONFIG.openaiApiKey}`
            },
            body: JSON.stringify({
                model: 'gpt-4o-mini',
                max_tokens: 5,
                temperature: 0,
                messages: [
                    {
                        role: 'system',
                        content: 'You are an intent classifier. Reply with ONLY "yes" or "no". ' +
                                 'Does the user EXPLICITLY ask to open, view, show, or navigate to a form or page? ' +
                                 'Only reply "yes" if the message contains a clear action verb like open/view/show/go to directed at a form. ' +
                                 'Answering a question, providing information, or mentioning a document title is NOT a form open request.'
                    },
                    { role: 'user', content: message }
                ]
            })
        });

        clearTimeout(t);

        if (res.ok) {
            const data = await res.json();
            trackCost('gpt-4o-mini', data.usage);
            const answer = data.choices?.[0]?.message?.content?.trim().toLowerCase();
            if (answer === 'yes') {
                const url = getFormUrl();
                addMessage('user', message);
                const reply = `Opening the form for you now. It will load in a new tab.`;
                addMessage('assistant', reply);
                if (state.voiceMode) speakText(reply);
                window.open(url, '_blank');
                return true;
            }
        }
    } catch (e) {
        // Timeout or network error — let the normal pipeline handle it
    }
    return false;
}

/**
 * Detects whether the user is asking for suggestions/options/help.
 * If yes AND no suggestion pills are currently visible, asks OpenAI to generate
 * 3-4 contextual suggestions based on the conversation, then shows them as pills.
 * Returns true if handled so sendMessage skips the normal chat pipeline.
 */
async function checkAndHandleSuggestionsIntent(message) {
    if (!state.sessionStarted || !CONFIG.openaiApiKey) return false;

    // Only trigger if there are no suggestion pills currently visible
    const pillsVisible = document.querySelectorAll('.suggestions').length > 0;
    if (pillsVisible) return false;

    try {
        // Step 1 — intent classification (fast, 4s max)
        const ctrl1 = new AbortController();
        const t1 = setTimeout(() => ctrl1.abort(), 4000);

        const intentRes = await fetch('https://api.openai.com/v1/chat/completions', {
            method: 'POST',
            signal: ctrl1.signal,
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${CONFIG.openaiApiKey}` },
            body: JSON.stringify({
                model: 'gpt-4o-mini',
                max_tokens: 5,
                temperature: 0,
                messages: [
                    {
                        role: 'system',
                        content: 'You are an intent classifier. Reply ONLY "yes" or "no". ' +
                                 'Is the user asking for suggestions, options, ideas, examples, or help on what to say or do next?'
                    },
                    { role: 'user', content: message }
                ]
            })
        });
        clearTimeout(t1);

        if (!intentRes.ok) return false;
        const intentData = await intentRes.json();
        trackCost('gpt-4o-mini', intentData.usage);
        const isIntent = intentData.choices?.[0]?.message?.content?.trim().toLowerCase() === 'yes';
        if (!isIntent) return false;

        // Step 2 — generate contextual suggestions
        const recentHistory = state.conversationHistory.slice(-6)
            .map(m => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`)
            .join('\n');

        const ctrl2 = new AbortController();
        const t2 = setTimeout(() => ctrl2.abort(), 6000);

        const suggRes = await fetch('https://api.openai.com/v1/chat/completions', {
            method: 'POST',
            signal: ctrl2.signal,
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${CONFIG.openaiApiKey}` },
            body: JSON.stringify({
                model: 'gpt-4o-mini',
                max_tokens: 120,
                temperature: 0.7,
                messages: [
                    {
                        role: 'system',
                        content: `You are a helpful assistant for a workplace health & safety app. ` +
                                 `The user is filling in a form called "${state.templateName || 'WHS form'}". ` +
                                 `Based on the conversation below, suggest 3 short, specific things the user could say or answer next. ` +
                                 `Return ONLY a JSON array of 3 strings, no explanation. Example: ["Yes, I was injured", "No injuries occurred", "I need more information"]`
                    },
                    { role: 'user', content: recentHistory }
                ]
            })
        });
        clearTimeout(t2);

        if (!suggRes.ok) return false;
        const suggData = await suggRes.json();
        trackCost('gpt-4o-mini', suggData.usage);
        const raw = suggData.choices?.[0]?.message?.content?.trim();

        let suggestions;
        try {
            suggestions = JSON.parse(raw);
        } catch(e) {
            const match = raw?.match(/\[.*\]/s);
            suggestions = match ? JSON.parse(match[0]) : null;
        }

        if (!Array.isArray(suggestions) || suggestions.length === 0) return false;

        // Show as an AI message with pills
        addMessage('user', message);
        const replyText = 'Here are some suggestions based on our conversation:';
        const messagesArea = document.getElementById('messagesArea');

        const messageDiv = document.createElement('div');
        messageDiv.className = 'message assistant';
        const icon = document.createElement('div');
        icon.className = 'message-icon';
        icon.innerHTML = '<i class="ph-thin ph-chats-circle"></i>';
        const contentDiv = document.createElement('div');
        contentDiv.className = 'message-content';
        contentDiv.textContent = replyText;

        const suggestionsDiv = document.createElement('div');
        suggestionsDiv.className = 'suggestions';
        suggestions.forEach(s => {
            const pill = document.createElement('button');
            pill.className = 'suggestion-pill';
            // Display without brackets, but keep brackets in the value
            pill.textContent = s.replace(/[\[\]]/g, '');
            pill.onclick = () => selectSuggestion(s);
            suggestionsDiv.appendChild(pill);
        });
        contentDiv.appendChild(suggestionsDiv);
        messageDiv.appendChild(icon);
        messageDiv.appendChild(contentDiv);
        messagesArea.appendChild(messageDiv);
        scrollToBottom();

        if (state.voiceMode) speakText(replyText + ' ' + suggestions.join('. '));

        return true;
    } catch(e) {
        // Timeout or parse error — fall through to normal chat
    }
    return false;
}

/**
 * Uses OpenAI to decide if the user wants to create a dashboard or report.
 * If yes, calls the DashboardAI generate endpoint and shows a link to the result.
 * Returns true if handled so sendMessage can skip the normal pipeline.
 */
async function checkAndHandleDashboardIntent(message) {
    if (!CONFIG.openaiApiKey) return false;
    try {
        const ctrl = new AbortController();
        const t = setTimeout(() => ctrl.abort(), 5000);

        const intentRes = await fetch('https://api.openai.com/v1/chat/completions', {
            method: 'POST',
            signal: ctrl.signal,
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${CONFIG.openaiApiKey}` },
            body: JSON.stringify({
                model: 'gpt-4o-mini',
                max_tokens: 5,
                temperature: 0,
                messages: [
                    {
                        role: 'system',
                        content: 'You are an intent classifier. Reply ONLY "yes" or "no". ' +
                                 'Is the user asking to create, build, generate, or show a dashboard, report, or analytics/data visualisation?'
                    },
                    { role: 'user', content: message }
                ]
            })
        });
        clearTimeout(t);

        if (!intentRes.ok) return false;
        const intentData = await intentRes.json();
        trackCost('gpt-4o-mini', intentData.usage);
        const answer = intentData.choices?.[0]?.message?.content?.trim().toLowerCase();
        if (answer !== 'yes') return false;

        // Show user message then a typing indicator
        addMessage('user', message);
        state._initialMessageBubbleShown = true;
        showTypingIndicator();

        const dashBase = 'https://beta.whsmonitor.com.au/dashboardv2';
        const genRes = await fetch(dashBase + '/api/dashboard/generate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                prompt:  message,
                storeId: CONFIG.storeId,
                userId:  String(CONFIG.userId)
            })
        });

        removeTypingIndicator();

        if (!genRes.ok) {
            // If no session exists yet, fall through to the normal template-chat flow
            // so the user's message still starts an intelligent session.
            if (!state.sessionStarted) {
                return false;
            }
            const err = await genRes.json().catch(() => ({}));
            addMessage('assistant', `⚠ Could not generate dashboard: ${err.error || 'Unknown error'}`);
            return true;
        }

        const result = await genRes.json();
        const url = dashBase + result.redirectUrl;

        state._initialMessageBubbleShown = false; // reset so next message works correctly
        parent.loadDashboardAI(url);

        return true;
    } catch (err) {
        if (err.name === 'AbortError') return false;
        console.error('[DashboardIntent]', err);
        return false;
    }
}

async function sendMessage() {
    const activeInput = getActiveInput();
    const message = activeInput.value.trim();
    // Capture HTML before anything clears the editor — used for display only, plain text goes to API
    state._pendingUserHtml = activeInput.htmlValue;

    if (!message) return;

    // Mark as processing so voice loop doesn't restart during API call
    state.isProcessing = true;

    // Check if awaiting template selection and try to match voice input
    if (state.awaitingTemplateSelection && state.availableTemplates.length > 0) {
        const matchedTemplate = matchVoiceToTemplate(message);
        if (matchedTemplate) {
            // Clear input first
            activeInput.value = '';
            activeInput.style.height = 'auto';
            if (state.voiceMode) {
                finalTranscript = '';
            }

            // Select the template
            await selectTemplate(matchedTemplate.templateID, matchedTemplate.templateName);
            state.isProcessing = false;
            return;
        }
    }

    // Hide empty state and show chat input
    document.getElementById('emptyState').style.display = 'none';
    document.getElementById('messagesArea').classList.add('active');
    document.getElementById('chatInputArea').style.display = 'block';

    // Check if the user is asking to open/view the form (only once a session exists)
    if (state.sessionStarted && state.regOthId) {
        const formHandled = await checkAndHandleFormIntent(message);
        if (formHandled) {
            activeInput.value = '';
            activeInput.style.height = 'auto';
            if (state.voiceMode) finalTranscript = '';
            state.isProcessing = false;
            return;
        }
    }

    // Check if the user is asking for suggestions
    if (state.sessionStarted) {
        const suggestionsHandled = await checkAndHandleSuggestionsIntent(message);
        if (suggestionsHandled) {
            activeInput.value = '';
            activeInput.style.height = 'auto';
            if (state.voiceMode) finalTranscript = '';
            state.isProcessing = false;
            if (state.voiceMode && !state.isSpeaking && !state.isListening) {
                setTimeout(() => startListening(), 600);
            }
            return;
        }
    }

    // Check if the user wants to create a dashboard or report
    const dashboardHandled = await checkAndHandleDashboardIntent(message);
    if (dashboardHandled) {
        activeInput.value = '';
        activeInput.style.height = 'auto';
        if (state.voiceMode) finalTranscript = '';
        state.isProcessing = false;
        if (state.voiceMode && !state.isSpeaking && !state.isListening) {
            setTimeout(() => startListening(), 600);
        }
        return;
    }

    // Check if this is the first message
    if (!state.sessionStarted) {
        await startIntelligentSession(message);
    } else {
        // Special handling for map confirmation via voice/typing
        // If user types/says "Yes" or "Confirm" for a map field, check if map is still visible
        if (state.currentFieldType === '10016' && 
            (message.toLowerCase() === 'yes' || message.toLowerCase() === 'confirm' || 
             message.toLowerCase() === 'correct' || message.toLowerCase() === "that's correct")) {
            
            // Check if map UI is still visible
            const mapContainer = document.querySelector('.map-container');
            if (mapContainer) {
                // Map is still visible, user typed "Yes" without clicking "Confirm Location"
                // Auto-extract the data from the map and confirm it
                const latInput = document.getElementById('mapLatitude');
                const lngInput = document.getElementById('mapLongitude');
                const locationNameDiv = document.getElementById('mapLocationName');
                
                if (latInput && lngInput && latInput.value && lngInput.value) {
                    const lat = parseFloat(latInput.value);
                    const lng = parseFloat(lngInput.value);
                    const locationText = locationNameDiv ? 
                        locationNameDiv.textContent
                            .replace('📍 ', '')
                            .replace('🔍 Looking up address...', 'Custom Location')
                            .replace(/^✓ Pre-filled from your message\s+/, '') // Remove the prefix if present
                        : 'Custom Location';
                    
                    if (!isNaN(lat) && !isNaN(lng)) {
                        // Format as JSON
                        const mapData = {
                            Latitude: lat,
                            Longitude: lng,
                            Location: locationText.trim()
                        };
                        const mapDataString = JSON.stringify(mapData);
                        
                        console.log('User typed "Yes" with map visible, auto-confirming location:', mapDataString);
                        
                        // Remove map UI
                        mapContainer.remove();
                        
                        // Reset map instances
                        mapInstance = null;
                        mapMarker = null;
                        mapGeocoder = null;
                        
                        // Send the JSON data
                        await sendChatMessage(mapDataString);
                        
                        // Clear the last map data
                        state.lastMapData = null;
                    } else {
                        // No valid coordinates on map, send as normal message
                        await sendChatMessage(message);
                    }
                } else {
                    // Map visible but no coordinates, send as normal message
                    await sendChatMessage(message);
                }
            } else if (state.lastMapData) {
                // Map already confirmed, use stored data
                console.log('User confirmed map location via input, sending stored map data:', state.lastMapData);
                await sendChatMessage(state.lastMapData);
                // Clear the last map data after using it
                state.lastMapData = null;
            } else {
                // No map and no stored data, send as normal message
                await sendChatMessage(message);
            }
        } else {
            await sendChatMessage(message);
        }
    }

    // Clear input
    activeInput.value = '';
    activeInput.style.height = 'auto';

    // Reset transcript if in voice mode
    if (state.voiceMode) {
        finalTranscript = '';
    }

    // Done processing - speakText will handle restarting the listener
    state.isProcessing = false;

    // Safety: if voice mode is on and TTS isn't running, restart listening now
    if (state.voiceMode && !state.isSpeaking && !state.isListening) {
        setTimeout(() => startListening(), 600);
    }
}

function matchVoiceToTemplate(spokenText) {
    const text = spokenText.toLowerCase().trim();

    // Number word mapping
    const numberWords = {
        'one': 1, 'first': 1, '1': 1,
        'two': 2, 'second': 2, '2': 2,
        'three': 3, 'third': 3, '3': 3,
        'four': 4, 'fourth': 4, '4': 4,
        'five': 5, 'fifth': 5, '5': 5
    };

    // Try to match by number
    for (const [word, num] of Object.entries(numberWords)) {
        if (text.includes(word)) {
            const index = num - 1;
            if (index >= 0 && index < state.availableTemplates.length) {
                console.log(`Matched template ${num}: ${state.availableTemplates[index].templateName}`);
                return state.availableTemplates[index];
            }
        }
    }

    // Try to match by template name (partial match)
    for (const template of state.availableTemplates) {
        const templateName = template.templateName.toLowerCase();
        const templateWords = templateName.split(' ');

        // Check if spoken text contains key words from template name
        let matchCount = 0;
        for (const word of templateWords) {
            if (word.length > 3 && text.includes(word)) {
                matchCount++;
            }
        }

        // If we matched at least 2 significant words, or the template name is in the text
        if (matchCount >= 2 || text.includes(templateName)) {
            console.log(`Matched template by name: ${template.templateName}`);
            return template;
        }
    }

    return null;
}

async function startIntelligentSession(initialMessage, selectedTemplateID = null) {
    // Store initial message
    if (!selectedTemplateID) {
        state.initialMessage = initialMessage;
        // Skip the bubble if the dashboard-intent path already rendered it
        if (!state._initialMessageBubbleShown) {
            addMessage('user', initialMessage);
        }
        state._initialMessageBubbleShown = false; // reset for next turn
    }

    // Show typing indicator
    showTypingIndicator();

    // Speak thinking phrase in voice mode (fire-and-forget — runs parallel to API call)
    speakThinking(selectedTemplateID ? 'template' : 'first', state.initialMessage);

    try {
        const requestBody = {
            storeID: CONFIG.storeId,
            createdByID: CONFIG.userId,
            createdByName: CONFIG.userName,
            initialMessage: state.initialMessage,
            currentDateTime: new Date().toISOString(),
            userTimezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
            userDateFormat: getUserDateFormat(),
            userProfile: CONFIG.userProfile
        };

        if (selectedTemplateID) {
            requestBody.selectedTemplateID = selectedTemplateID;
        }

        const response = await fetch(`${CONFIG.apiUrl}/start-intelligent`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(requestBody)
        });

        const data = await response.json();
        removeTypingIndicator();

        if (data.success) {
            // Template selection
            if (data.needsTemplateSelection && data.templateChoices && data.templateChoices.length > 0) {
                trackServerCost(data.tokenUsage);
                // Only auto-select if the message is detailed enough (20+ words)
                const wordCount = (state.initialMessage || '').trim().split(/\s+/).length;
                const autoID = wordCount >= 20
                    ? await autoSelectTemplate(state.initialMessage, data.templateChoices)
                    : null;
                if (autoID) {
                    await startIntelligentSession(null, autoID);
                    return;
                }
                // Couldn't confidently pick — fall back to manual selection
                addMessage('assistant', data.aiMessage);
                addTemplateList(data.templateChoices);
                state.awaitingTemplateSelection = true;
                return;
            }

            // Session created
            state.sessionStarted = true;
            state.awaitingTemplateSelection = false;
            state.regOthId = data.regOthID;
            state.internalNo = data.internalNo;
            state.templateName = data.templateName;
            state.moduleName = data.moduleName || '';
            trackServerCost(data.tokenUsage);
            // Show the progress toggle button now that a session exists
            document.getElementById('progressToggle').style.display = 'flex';
            state.conversationHistory = [
                { role: 'user', content: state.initialMessage },
                { role: 'assistant', content: data.aiMessage }
            ];

            // Store current field info
            state.currentFieldID = data.currentFieldID;
            state.currentFieldType = data.currentFieldType;

            // ── Smart Fill mode: skip field-by-field UI, bulk extract instead ──────
            if (isSmartFillEnabled()) {
                state.smartFillTriggered = true;
                showSmartFillTyping();
                setTimeout(() => runSmartFill(), 800);
                updateDebugInfo();
                return;
            }

            addMessage('assistant', data.aiMessage);

            // ALWAYS clean up previous field UI elements first (aggressive cleanup)
            setTimeout(() => {
                const existingFileUpload = document.querySelector('.file-upload-container');
                const existingMapContainer = document.querySelector('.map-container');
                
                // Remove file upload UI if NOT a file upload field
                if (state.currentFieldType !== '10013' && existingFileUpload) {
                    console.log('Removing file upload UI - field type changed to:', state.currentFieldType);
                    existingFileUpload.remove();
                }
                // Remove map UI if NOT a map field
                if (state.currentFieldType !== '10016' && existingMapContainer) {
                    console.log('Removing map UI - field type changed to:', state.currentFieldType);
                    existingMapContainer.remove();
                }

                // Show file upload UI if current field is a file upload (Type Code 10013)
                if (state.currentFieldType === '10013') {
                    addFileUploadUI();
                }
                // Show map UI if current field is a map (Type Code 10016)
                else if (state.currentFieldType === '10016') {
                // Check if AI already extracted a location from the message
                let initialLocation = null;
                
                console.log('[Intelligent Start] Map field detected. Checking for location...');
                console.log('Current field ID:', state.currentFieldID);
                console.log('Extracted fields:', data.extractedFields);
                console.log('Initial message:', state.initialMessage);
                
                if (data.extractedFields && data.extractedFields.length > 0) {
                    const mapField = data.extractedFields.find(f => f.fieldID === state.currentFieldID);
                    console.log('Found map field in extractedFields:', mapField);
                    if (mapField && mapField.extractedValue) {
                        try {
                            const mapData = JSON.parse(mapField.extractedValue);
                            initialLocation = mapData.Location || null;
                            console.log('Parsed location from extractedValue:', initialLocation);
                        } catch (e) {
                            // If not JSON, try to use the value as-is
                            initialLocation = mapField.extractedValue;
                            console.log('Using extractedValue as-is:', initialLocation);
                        }
                    }
                }
                
                // If no location in extractedFields, try to extract from initial message
                if (!initialLocation && state.initialMessage) {
                    // Simple regex patterns to detect locations
                    const locationPatterns = [
                        /(?:at|location:|address:)\s*([^.!?,]+)/i,
                        /(\d+\s+[A-Za-z\s]+(?:Street|St|Road|Rd|Avenue|Ave|Drive|Dr|Lane|Ln|Boulevard|Blvd|Way|Place|Pl)[^.!?,]*)/i,
                        /([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*,\s*[A-Z]{2,})/  // City, State format
                    ];
                    
                    for (const pattern of locationPatterns) {
                        const match = state.initialMessage.match(pattern);
                        if (match && match[1]) {
                            initialLocation = match[1].trim();
                            console.log('Extracted location from initial message:', initialLocation);
                            break;
                        }
                    }
                }
                
                console.log('Final initialLocation:', initialLocation);
                addMapUI(initialLocation);
            }

            // Add suggestions (skip for map fields - use Confirm Location button instead)
            if (data.nextSuggestedQuestions && data.nextSuggestedQuestions.length > 0 
                && state.currentFieldType !== '10016') {
                addSuggestions(data.nextSuggestedQuestions);
            }

            // Update progress
            if (data.completionPercentage !== undefined) {
                updateProgress(data.completionPercentage);
            }

            updateDebugInfo();
            }, 50); // Small delay to ensure DOM has settled

        } else {
            addMessage('assistant', `${data.errorMessage || 'Failed to start session'}`);
        }
    } catch (error) {
        removeTypingIndicator();
        addMessage('assistant', `Error: ${error.message}`);
    }
}

async function sendChatMessage(message) {
    addMessage('user', message);

    // Add to conversation history
    state.conversationHistory.push({
        role: 'user',
        content: message
    });

    showTypingIndicator();

    // Speak thinking phrase in voice mode (fire-and-forget — runs parallel to API call)
    speakThinking('chat', message);

    try {
        const response = await fetch(`${CONFIG.apiUrl}/chat`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                regOthID: state.regOthId,
                storeID: CONFIG.storeId,
                userMessage: message,
                userID: CONFIG.userId,
                conversationHistory: state.conversationHistory.slice(-10),
                fullConversationHistory: state.conversationHistory,
                currentDateTime: new Date().toISOString(),
                userTimezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
                userDateFormat: getUserDateFormat(),
                memoryConfidence: localStorage.getItem('memoryConfidence') || 'medium',
                userProfile: CONFIG.userProfile
            })
        });

        const data = await response.json();
        removeTypingIndicator();

        if (data.success) {
            addMessage('assistant', data.aiMessage);
            trackServerCost(data.tokenUsage);

            // Store current field info
            state.currentFieldID = data.currentFieldID;
            state.currentFieldType = data.currentFieldType;
            
            // Clear lastMapData if we've moved away from map field
            if (state.currentFieldType !== '10016' && state.lastMapData) {
                console.log('Moved to new field type, clearing lastMapData');
                state.lastMapData = null;
            }

            // Wrap cleanup and UI operations in setTimeout to prevent race condition
            setTimeout(() => {
                console.log('[CLEANUP] Starting field UI cleanup for sendChatMessage');
                console.log('[CLEANUP] Current field type:', state.currentFieldType);
                
                // Clean up previous field UI elements
                const existingFileUpload = document.querySelector('.file-upload-container');
                const existingMapContainer = document.querySelector('.map-container');
                
                console.log('[CLEANUP] Found file upload container:', !!existingFileUpload);
                console.log('[CLEANUP] Found map container:', !!existingMapContainer);
                
                if (state.currentFieldType !== '10013' && existingFileUpload) {
                    console.log('[CLEANUP] Removing file upload container');
                    existingFileUpload.remove();
                }
                if (state.currentFieldType !== '10016' && existingMapContainer) {
                    console.log('[CLEANUP] Removing map container');
                    existingMapContainer.remove();
                }

                // Show file upload UI if current field is a file upload (Type Code 10013)
                if (state.currentFieldType === '10013') {
                    console.log('[CLEANUP] Adding file upload UI');
                    addFileUploadUI();
                }
                // Show map UI if current field is a map (Type Code 10016)
                else if (state.currentFieldType === '10016') {
                    // Check if AI already extracted a location from the message
                    let initialLocation = null;
                    
                    console.log('Map field detected. Checking for location...');
                    console.log('Current field ID:', state.currentFieldID);
                    console.log('Extracted fields:', data.extractedFields);
                    console.log('AI message:', data.aiMessage);
                    console.log('User message:', message);
                    
                    if (data.extractedFields && data.extractedFields.length > 0) {
                        const mapField = data.extractedFields.find(f => f.fieldID === state.currentFieldID);
                        console.log('Found map field in extractedFields:', mapField);
                        if (mapField && mapField.extractedValue) {
                            try {
                                const mapData = JSON.parse(mapField.extractedValue);
                                initialLocation = mapData.Location || null;
                                console.log('Parsed location from extractedValue:', initialLocation);
                            } catch (e) {
                                // If not JSON, try to use the value as-is
                                initialLocation = mapField.extractedValue;
                                console.log('Using extractedValue as-is:', initialLocation);
                            }
                        }
                    }
                    
                    // If no location in extractedFields, try to extract from AI message (it often repeats the address)
                    if (!initialLocation && data.aiMessage) {
                        // Pattern to detect addresses in quotes or mentioned by AI
                        const addressPatterns = [
                            /"([^"]+(?:Street|St|Road|Rd|Avenue|Ave|Drive|Dr|Lane|Ln|Boulevard|Blvd|Way|Place|Pl)[^"]+)"/i,
                            /address\s+"([^"]+)"/i,
                            /location\s+"([^"]+)"/i,
                            /(\d+\/\d+\s+[^,]+,\s*[^,]+(?:,\s*[A-Z]{2,4}(?:\s+\d+)?)?(?:,\s*[A-Za-z\s]+)?)/i, // Matches "3/9 McKay Lane, Turner ACT 2612, Australia"
                            /(\d+\s+[A-Za-z\s]+(?:Street|St|Road|Rd|Avenue|Ave|Drive|Dr|Lane|Ln|Boulevard|Blvd|Way|Place|Pl)[^.!?,]*)/i
                        ];
                        
                        for (const pattern of addressPatterns) {
                            const match = data.aiMessage.match(pattern);
                            if (match && match[1]) {
                                initialLocation = match[1].trim();
                                console.log('Extracted location from AI message:', initialLocation);
                                break;
                            }
                        }
                    }
                    
                    // If still no location, try to extract from user's message
                    if (!initialLocation && message) {
                        const locationPatterns = [
                            /(?:at|location:|address:)\s*([^.!?,]+)/i,
                            /(\d+\s+[A-Za-z\s]+(?:Street|St|Road|Rd|Avenue|Ave|Drive|Dr|Lane|Ln|Boulevard|Blvd|Way|Place|Pl)[^.!?,]*)/i,
                            /([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*,\s*[A-Z]{2,})/
                        ];
                        
                        for (const pattern of locationPatterns) {
                            const match = message.match(pattern);
                            if (match && match[1]) {
                                initialLocation = match[1].trim();
                                console.log('Extracted location from user message:', initialLocation);
                                break;
                            }
                        }
                    }
                    
                    // Last resort: search conversation history for recent addresses
                    if (!initialLocation && state.conversationHistory && state.conversationHistory.length > 0) {
                        console.log('Searching conversation history for addresses...');
                        const addressPattern = /(\d+(?:\/\d+)?\s+[A-Za-z\s]+(?:Street|St|Road|Rd|Avenue|Ave|Drive|Dr|Lane|Ln|Boulevard|Blvd|Way|Place|Pl)[^.!?,]*(?:,\s*[^.!?,]+)?)/i;
                        
                        // Search last 5 messages
                        for (let i = state.conversationHistory.length - 1; i >= Math.max(0, state.conversationHistory.length - 5); i--) {
                            const msg = state.conversationHistory[i];
                            if (msg.role === 'user' && msg.content) {
                                const match = msg.content.match(addressPattern);
                                if (match && match[1]) {
                                    initialLocation = match[1].trim();
                                    console.log('Found location in conversation history:', initialLocation);
                                    break;
                                }
                            }
                        }
                    }
                    
                    console.log('Final initialLocation:', initialLocation);
                    addMapUI(initialLocation);
                }

                // Add suggestions (skip for map fields - use Confirm Location button instead)
                if (data.nextSuggestedQuestions && data.nextSuggestedQuestions.length > 0 
                    && state.currentFieldType !== '10016') {
                    console.log('[CLEANUP] Adding suggestions');
                    addSuggestions(data.nextSuggestedQuestions);
                }

                console.log('[CLEANUP] Field UI cleanup complete');
            }, 50); // 50ms delay to prevent race condition

            // Add to history
            state.conversationHistory.push({
                role: 'assistant',
                content: data.aiMessage
            });

            // Update extracted fields
            if (data.extractedFields && data.extractedFields.length > 0) {
                data.extractedFields.forEach(field => {
                    state.extractedFieldsMap.set(field.fieldID, field);
                });
                showFieldsSummary(data.extractedFields);
                updateFieldsList();

                // Auto-refresh memory panel ~3s later (fire-and-forget runs server-side in background)
                scheduleMemoryRefresh();
            }

            // Update progress
            if (data.completionPercentage !== undefined) {
                updateProgress(data.completionPercentage);
            }

            // AI signals all fields are covered — prompt user to complete
            if (data.isComplete && !state.sessionCompleted) {
                setTimeout(() => promptCompletion(), 600);
            }

            updateDebugInfo();
        } else {
            addMessage('assistant', ` ${data.errorMessage || 'Error'}`);
        }
    } catch (error) {
        removeTypingIndicator();
        addMessage('assistant', ` Error: ${error.message}`);
    }
}

function promptCompletion() {
    if (state.sessionCompleted) return;
    const messagesArea = document.getElementById('messagesArea');

    const messageDiv = document.createElement('div');
    messageDiv.className = 'message assistant';

    const icon = document.createElement('div');
    icon.className = 'message-icon';
    icon.innerHTML = '<i class="ph-thin ph-chats-circle"></i>';

    const contentDiv = document.createElement('div');
    contentDiv.className = 'message-content';
    contentDiv.textContent = "It looks like we've covered everything! Would you like to complete the session now?";

    const actionsDiv = document.createElement('div');
    actionsDiv.className = 'suggestions';
    actionsDiv.style.marginTop = '12px';

    const yesBtn = document.createElement('button');
    yesBtn.className = 'suggestion-pill';
    yesBtn.textContent = 'Yes, complete it';
    yesBtn.onclick = () => { actionsDiv.remove(); completeSession(); };

    const noBtn = document.createElement('button');
    noBtn.className = 'suggestion-pill';
    noBtn.style.background = '#6b7280';
    noBtn.textContent = 'Not yet';
    noBtn.onclick = () => actionsDiv.remove();

    actionsDiv.appendChild(yesBtn);
    actionsDiv.appendChild(noBtn);
    contentDiv.appendChild(actionsDiv);
    messageDiv.appendChild(icon);
    messageDiv.appendChild(contentDiv);
    messagesArea.appendChild(messageDiv);
    scrollToBottom();

    if (state.voiceMode) speakText("It looks like we've covered everything! Would you like to complete the session now?");
}

// Strip font-size from inline styles so pasted content doesn't carry over font sizing
function stripFontSizes(html) {
    return html
        .replace(/font-size\s*:[^;"'}]+[;]?/gi, '')
        .replace(/(<[^>]+)\bsize\s*=\s*["'][^"']*["']/gi, '$1');
}

// Check if content is map JSON data
function isMapJSON(content) {
    if (!content || typeof content !== 'string') return false;
    try {
        const data = JSON.parse(content);
        return data && 
               typeof data.Latitude === 'number' && 
               typeof data.Longitude === 'number' && 
               typeof data.Location === 'string';
    } catch (e) {
        return false;
    }
}

// Format map JSON data as plain text
function formatMapJSON(jsonString) {
    try {
        const data = JSON.parse(jsonString);
        return escapeHtml(data.Location);
    } catch (e) {
        // Fallback to plain text if parsing fails
        return escapeHtml(jsonString);
    }
}

// Helper to escape HTML
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function addMessage(role, content) {
    const messagesArea = document.getElementById('messagesArea');

    const messageDiv = document.createElement('div');
    messageDiv.className = `message ${role}`;

    const icon = document.createElement('div');
    icon.className = 'message-icon';
    if (role === 'user') {
        icon.textContent = CONFIG.userName.charAt(0).toUpperCase();
    } else {
        icon.innerHTML = '<i class="ph-thin ph-chats-circle"></i>';
    }

    const contentDiv = document.createElement('div');
    contentDiv.className = 'message-content';
    if (role === 'user' && state._pendingUserHtml) {
        contentDiv.innerHTML = stripFontSizes(state._pendingUserHtml);
        state._pendingUserHtml = null;
    } else if (role === 'user' && isMapJSON(content)) {
        // Special formatting for map JSON data from user
        contentDiv.innerHTML = formatMapJSON(content);
    } else if (role === 'assistant' && typeof marked !== 'undefined') {
        contentDiv.innerHTML = marked.parse(content);
    } else {
        contentDiv.textContent = content;
    }

    messageDiv.appendChild(icon);
    messageDiv.appendChild(contentDiv);

    messagesArea.appendChild(messageDiv);
    scrollToBottom();

    // If voice mode is active and this is an AI message, speak it
    if (state.voiceMode && role === 'assistant') {
        state.lastAiMessage = content;
        speakText(content);
    }
}

function addAIMessage(content) {
    addMessage('assistant', content);
}

async function autoSelectTemplate(message, templates) {
    try {
        // Handle both camelCase (templateID) and PascalCase (TemplateID) from API
        const getId = t => t.templateID ?? t.TemplateID;
        const getName = t => t.templateName ?? t.TemplateName ?? '';
        const getDesc = t => t.templateDescription ?? t.TemplateDescription ?? '';
        const templateList = templates.map(t =>
            `- ID ${getId(t)}: ${getName(t)}${getDesc(t) ? ' — ' + getDesc(t) : ''}`
        ).join('\n');
        const response = await fetch('https://api.openai.com/v1/chat/completions', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${CONFIG.openaiApiKey}` },
            signal: AbortSignal.timeout(5000),
            body: JSON.stringify({
                model: 'gpt-4o-mini',
                max_tokens: 10,
                messages: [
                    {
                        role: 'system',
                        content: 'You are a form template matcher. Given a user message and a list of templates, reply with ONLY the numeric templateID of the single best match. If you cannot confidently decide, reply with 0.'
                    },
                    {
                        role: 'user',
                        content: `User message:\n"${message}"\n\nAvailable templates:\n${templateList}\n\nReply with the templateID number only.`
                    }
                ]
            })
        });
        const data = await response.json();
        trackCost('gpt-4o-mini', data.usage);
        const raw = (data.choices?.[0]?.message?.content || '').trim();
        const parsed = parseInt(raw, 10);
        if (!isNaN(parsed) && parsed > 0) {
            const match = templates.find(t => getId(t) === parsed);
            if (match) {
                console.log(`[autoSelectTemplate] Auto-selected: ${getName(match)} (ID ${parsed})`);
                return parsed;
            }
        }
    } catch (e) {
        console.warn('[autoSelectTemplate] Failed:', e);
    }
    return null;
}

function addTemplateList(templates) {
    // Store templates for voice recognition
    state.availableTemplates = templates;

    const messagesArea = document.getElementById('messagesArea');
    const lastMessage = messagesArea.lastElementChild;

    // Add numbered list to last message
    const listDiv = document.createElement('div');
    listDiv.className = 'template-list';

    templates.forEach((template, index) => {
        const item = document.createElement('div');
        item.className = 'template-list-item';
        item.textContent = `${index + 1}. ${template.templateName}`;
        listDiv.appendChild(item);
    });

    const question = document.createElement('div');
    question.className = 'template-question';
    question.textContent = 'Which one would you like to Complete';

    lastMessage.querySelector('.message-content').appendChild(listDiv);
    lastMessage.querySelector('.message-content').appendChild(question);

    // Add number pills
    const suggestions = document.createElement('div');
    suggestions.className = 'suggestions';

    templates.forEach((template, index) => {
        const pill = document.createElement('button');
        pill.className = 'suggestion-pill';
        pill.textContent = template.templateName;
        pill.onclick = () => selectTemplate(template.templateID, template.templateName);
        suggestions.appendChild(pill);
    });

    lastMessage.querySelector('.message-content').appendChild(suggestions);
    scrollToBottom();
}

async function selectTemplate(templateID, displayText) {
    // Remove all suggestion pills
    document.querySelectorAll('.suggestions').forEach(el => el.remove());

    // Add user's selection
    addMessage('user', displayText);

    // Call intelligent start with selected template
    await startIntelligentSession(state.initialMessage, templateID);
}

function addSuggestions(suggestions) {
    if (!suggestions || suggestions.length === 0) return;

    const messagesArea = document.getElementById('messagesArea');
    const lastMessage = messagesArea.lastElementChild;

    const suggestionsDiv = document.createElement('div');
    suggestionsDiv.className = 'suggestions';

    suggestions.forEach(suggestion => {
        const pill = document.createElement('button');
        pill.className = 'suggestion-pill';
        // Display without brackets, but keep brackets in the value
        pill.textContent = suggestion.replace(/[\[\]]/g, '');
        pill.onclick = () => selectSuggestion(suggestion);
        suggestionsDiv.appendChild(pill);
    });

    lastMessage.querySelector('.message-content').appendChild(suggestionsDiv);
    scrollToBottom();
}

function selectSuggestion(suggestion) {
    // Remove all suggestions
    document.querySelectorAll('.suggestions').forEach(el => el.remove());

    // Special handling for map confirmation
    // If user clicks "Yes" for a map field, check if map is still visible and has data
    const cleanSuggestion = suggestion.replace(/[\[\]]/g, '').toLowerCase();
    if (state.currentFieldType === '10016' && 
        (cleanSuggestion === 'yes' || cleanSuggestion === 'confirm')) {
        
        // Check if map UI is still visible
        const mapContainer = document.querySelector('.map-container');
        if (mapContainer) {
            // Map is still visible, user clicked "Yes" without clicking "Confirm Location"
            // Auto-extract the data from the map and confirm it
            const latInput = document.getElementById('mapLatitude');
            const lngInput = document.getElementById('mapLongitude');
            const locationNameDiv = document.getElementById('mapLocationName');
            
            if (latInput && lngInput && latInput.value && lngInput.value) {
                const lat = parseFloat(latInput.value);
                const lng = parseFloat(lngInput.value);
                const locationText = locationNameDiv ? 
                    locationNameDiv.textContent
                        .replace('📍 ', '')
                        .replace('🔍 Looking up address...', 'Custom Location')
                        .replace(/^✓ Pre-filled from your message\s+/, '') // Remove the prefix if present
                    : 'Custom Location';
                
                if (!isNaN(lat) && !isNaN(lng)) {
                    // Format as JSON
                    const mapData = {
                        Latitude: lat,
                        Longitude: lng,
                        Location: locationText.trim()
                    };
                    const mapDataString = JSON.stringify(mapData);
                    
                    console.log('User clicked "Yes" with map visible, auto-confirming location:', mapDataString);
                    
                    // Remove map UI
                    mapContainer.remove();
                    
                    // Reset map instances
                    mapInstance = null;
                    mapMarker = null;
                    mapGeocoder = null;
                    
                    // Send the JSON data
                    getActiveInput().value = mapDataString;
                    sendMessage();
                    
                    // Clear the last map data
                    state.lastMapData = null;
                    return;
                }
            }
        }
        
        // If we have stored map data (user already clicked "Confirm Location"), use it
        if (state.lastMapData) {
            console.log('User confirmed map location with "Yes", sending stored map data:', state.lastMapData);
            getActiveInput().value = state.lastMapData;
            sendMessage();
            // Clear the last map data after using it
            state.lastMapData = null;
            return;
        }
    }

    // Send as user message via the currently active input
    getActiveInput().value = suggestion;
    sendMessage();
}

function addFileUploadUI() {
    const messagesArea = document.getElementById('messagesArea');
    const lastMessage = messagesArea.lastElementChild;
    
    const fileUploadDiv = document.createElement('div');
    fileUploadDiv.className = 'file-upload-container';
    fileUploadDiv.style.cssText = 'margin-top: 12px; padding: 16px; background: #f8f9fa; border-radius: 8px; border: 2px dashed #dee2e6;';
    
    fileUploadDiv.innerHTML = `
        <div style="display: flex; align-items: center; gap: 12px;">
            <input type="file" id="fileUploadInput" style="flex: 1; padding: 8px; border: 1px solid #ced4da; border-radius: 4px; background: white;">
            <button id="fileUploadButton" onclick="handleFileUpload()" style="padding: 8px 16px; background: #0d6efd; color: white; border: none; border-radius: 4px; cursor: pointer; font-weight: 500;">
                Upload
            </button>
        </div>
        <div id="fileUploadProgress" style="margin-top: 8px; display: none; color: #6c757d; font-size: 13px;"></div>
    `;
    
    lastMessage.querySelector('.message-content').appendChild(fileUploadDiv);
    scrollToBottom();
}

async function handleFileUpload() {
    const fileInput = document.getElementById('fileUploadInput');
    const progress = document.getElementById('fileUploadProgress');
    const uploadButton = document.getElementById('fileUploadButton');
    
    if (!fileInput.files || fileInput.files.length === 0) {
        alert('Please select a file first');
        return;
    }
    
    const file = fileInput.files[0];
    const formData = new FormData();
    formData.append('file', file);
    formData.append('regOthID', state.regOthId);
    formData.append('storeID', CONFIG.storeId);
    
    try {
        uploadButton.disabled = true;
        uploadButton.style.opacity = '0.6';
        uploadButton.style.cursor = 'not-allowed';
        progress.style.display = 'block';
        progress.textContent = 'Uploading...';
        
        const response = await fetch(`${CONFIG.apiUrl}/upload`, {
            method: 'POST',
            body: formData
        });
        
        const data = await response.json();
        
        if (data.success) {
            progress.textContent = `✓ Uploaded: ${file.name}`;
            progress.style.color = '#198754';
            
            // Remove file upload UI
            const fileUploadContainer = document.querySelector('.file-upload-container');
            if (fileUploadContainer) {
                fileUploadContainer.remove();
            }
            
            // Auto-submit the file path as the answer
            await sendChatMessage(data.filePath);
        } else {
            progress.textContent = ` Upload failed: ${data.errorMessage || 'Unknown error'}`;
            progress.style.color = '#dc3545';
            uploadButton.disabled = false;
            uploadButton.style.opacity = '1';
            uploadButton.style.cursor = 'pointer';
        }
    } catch (error) {
        progress.textContent = ` Error: ${error.message}`;
        progress.style.color = '#dc3545';
        uploadButton.disabled = false;
        uploadButton.style.opacity = '1';
        uploadButton.style.cursor = 'pointer';
    }
}

// Google Maps state
let mapInstance = null;
let mapMarker = null;
let mapGeocoder = null;

function loadGoogleMapsAPI() {
    return new Promise((resolve, reject) => {
        if (window.google && window.google.maps) {
            resolve();
            return;
        }
        
        // Load the Maps JavaScript API with Places library
        const script = document.createElement('script');
        script.src = `https://maps.googleapis.com/maps/api/js?key=${CONFIG.googleMapsApiKey}&libraries=places&v=weekly`;
        script.async = true;
        script.defer = true;
        script.onload = () => {
            console.log('Google Maps API loaded successfully');
            resolve();
        };
        script.onerror = (error) => {
            console.error('Failed to load Google Maps:', error);
            reject(new Error('Failed to load Google Maps'));
        };
        document.head.appendChild(script);
    });
}

async function addMapUI(initialLocation = null) {
    const messagesArea = document.getElementById('messagesArea');
    const lastMessage = messagesArea.lastElementChild;
    
    const mapContainer = document.createElement('div');
    mapContainer.className = 'map-container';
    mapContainer.style.cssText = 'margin-top: 12px; padding: 16px; background: #f8f9fa; border-radius: 8px;';
    
    mapContainer.innerHTML = `
        <div style="margin-bottom: 12px; position: relative;">
            <input type="text" id="mapSearchInput" placeholder="Search for a location..." 
                style="width: 100%; padding: 10px; border: 1px solid #ced4da; border-radius: 4px; font-size: 14px;">
        </div>
        <div id="googleMap" style="width: 100%; height: 400px; border-radius: 8px; border: 2px solid #dee2e6;"></div>
        <div style="margin-top: 12px; display: flex; gap: 8px; align-items: center;">
            <div style="flex: 1; display: grid; grid-template-columns: 1fr 1fr; gap: 8px;">
                <div>
                    <label style="display: block; font-size: 12px; color: #6c757d; margin-bottom: 4px;">Latitude</label>
                    <input type="text" id="mapLatitude" readonly 
                        style="width: 100%; padding: 6px; border: 1px solid #ced4da; border-radius: 4px; background: #e9ecef; font-size: 13px;">
                </div>
                <div>
                    <label style="display: block; font-size: 12px; color: #6c757d; margin-bottom: 4px;">Longitude</label>
                    <input type="text" id="mapLongitude" readonly 
                        style="width: 100%; padding: 6px; border: 1px solid #ced4da; border-radius: 4px; background: #e9ecef; font-size: 13px;">
                </div>
            </div>
           <button id="mapConfirmButton" onclick="handleMapConfirm()" style="padding: 8px 20px;background: #3B98F1;color: white;border: none;border-radius: 4px;cursor: pointer;font-weight: 500;white-space: nowrap;opacity: 1;margin-top: 21px;">
               Confirm Location
            </button>
        </div>
        <div id="mapLocationName" style="margin-top: 8px; font-size: 13px; color: #495057;"></div>
    `;
    
    lastMessage.querySelector('.message-content').appendChild(mapContainer);
    scrollToBottom();
    
    // Load Google Maps API and initialize
    try {
        await loadGoogleMapsAPI();
        initializeMap(initialLocation);
    } catch (error) {
        document.getElementById('googleMap').innerHTML = `
            <div style="height: 100%; display: flex; align-items: center; justify-content: center; color: #dc3545;">
                Failed to load Google Maps. Please refresh the page.
            </div>
        `;
    }
}

function initializeMap(initialLocation = null) {
    const mapElement = document.getElementById('googleMap');
    const autocompleteElement = document.getElementById('mapSearchInput');
    
    // Default center (Sydney, Australia)
    const defaultCenter = { lat: -33.8688, lng: 151.2093 };
    
    // Initialize map
    mapInstance = new google.maps.Map(mapElement, {
        center: defaultCenter,
        zoom: 13,
        mapTypeControl: true,
        streetViewControl: false,
        fullscreenControl: false
    });
    
    // Initialize geocoder
    mapGeocoder = new google.maps.Geocoder();
    
    // Initialize marker (using standard marker for compatibility)
    mapMarker = new google.maps.Marker({
        map: mapInstance,
        draggable: true,
        visible: false
    });
    
    // Initialize autocomplete service with Place Autocomplete
    if (autocompleteElement) {
        const autocompleteService = new google.maps.places.AutocompleteService();
        const placesService = new google.maps.places.PlacesService(mapInstance);
        let autocompleteResults = [];
        let selectedIndex = -1;
        
        // Create dropdown for suggestions
        const dropdown = document.createElement('div');
        dropdown.id = 'mapSearchDropdown';
        dropdown.style.cssText = 'position: absolute; top: 100%; left: 0; right: 0; background: white; border: 1px solid #ced4da; border-top: none; border-radius: 0 0 4px 4px; max-height: 300px; overflow-y: auto; z-index: 1000; display: none; box-shadow: 0 4px 6px rgba(0,0,0,0.1);';
        autocompleteElement.parentElement.appendChild(dropdown);
        
        // Handle input changes
        let debounceTimer;
        autocompleteElement.addEventListener('input', () => {
            clearTimeout(debounceTimer);
            const query = autocompleteElement.value.trim();
            
            if (query.length < 2) {
                dropdown.style.display = 'none';
                return;
            }
            
            debounceTimer = setTimeout(() => {
                autocompleteService.getPlacePredictions(
                    { input: query },
                    (predictions, status) => {
                        if (status === google.maps.places.PlacesServiceStatus.OK && predictions) {
                            autocompleteResults = predictions;
                            displaySuggestions(predictions);
                        } else {
                            dropdown.style.display = 'none';
                        }
                    }
                );
            }, 300);
        });
        
        // Display suggestions
        function displaySuggestions(predictions) {
            dropdown.innerHTML = '';
            dropdown.style.display = 'block';
            
            predictions.forEach((prediction, index) => {
                const item = document.createElement('div');
                item.style.cssText = 'padding: 10px; cursor: pointer; border-bottom: 1px solid #f0f0f0;';
                item.textContent = prediction.description;
                
                item.addEventListener('mouseenter', () => {
                    item.style.background = '#f8f9fa';
                });
                
                item.addEventListener('mouseleave', () => {
                    item.style.background = 'white';
                });
                
                item.addEventListener('click', () => {
                    selectPlace(prediction.place_id, prediction.description);
                });
                
                dropdown.appendChild(item);
            });
        }
        
        // Select a place and get its details
        function selectPlace(placeId, description) {
            console.log('Place selected:', placeId, description);
            
            placesService.getDetails(
                { placeId: placeId, fields: ['geometry', 'name', 'formatted_address'] },
                (place, status) => {
                    if (status === google.maps.places.PlacesServiceStatus.OK && place.geometry) {
                        const location = place.geometry.location;
                        const locationName = place.name || place.formatted_address || description;
                        
                        console.log('Got place details:', location);
                        
                        placeMarker(location, locationName);
                        mapInstance.setCenter(location);
                        mapInstance.setZoom(17);
                        
                        autocompleteElement.value = '';
                        dropdown.style.display = 'none';
                    } else {
                        console.error('Place details request failed:', status);
                        alert('Failed to get location details. Please try again.');
                    }
                }
            );
        }
        
        // Hide dropdown when clicking outside
        document.addEventListener('click', (e) => {
            if (!autocompleteElement.contains(e.target) && !dropdown.contains(e.target)) {
                dropdown.style.display = 'none';
            }
        });
    }
    
    // Handle map click to place marker
    mapInstance.addListener('click', (event) => {
        placeMarker(event.latLng);
    });
    
    // Handle marker drag
    mapMarker.addListener('dragend', (event) => {
        placeMarker(event.latLng);
    });
    
    // Try to get user's current location
    if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(
            (position) => {
                const userLocation = {
                    lat: position.coords.latitude,
                    lng: position.coords.longitude
                };
                // Only center on user location if no initial location was provided
                if (!initialLocation) {
                    mapInstance.setCenter(userLocation);
                }
            },
            () => {
                // User denied or error - stay with default center
            }
        );
    }
    
    // Auto-populate and search if initial location was provided by AI
    if (initialLocation && autocompleteElement) {
        console.log('Auto-populating map with location:', initialLocation);
        
        // Set the search input value
        autocompleteElement.value = initialLocation;
        
        // Use Geocoding API to find the location
        const geocoder = new google.maps.Geocoder();
        geocoder.geocode({ address: initialLocation }, (results, status) => {
            if (status === 'OK' && results[0]) {
                const location = results[0].geometry.location;
                const locationName = results[0].formatted_address;
                
                console.log('Found location:', locationName, location);
                
                // Place marker and center map
                placeMarker(location, locationName);
                mapInstance.setCenter(location);
                mapInstance.setZoom(17);
                
                // Show a subtle notification
                const locationNameDiv = document.getElementById('mapLocationName');
                if (locationNameDiv) {
                    locationNameDiv.innerHTML = `<span style="color: #28a745;">${locationName}`;
                }
            } else {
                console.warn('Geocoding failed for:', initialLocation, status);
                // Keep the text in search box so user can manually search
            }
        });
    }
}

function placeMarker(location, locationName = null) {
    mapMarker.setPosition(location);
    mapMarker.setVisible(true);
    
    // Add bounce animation to make the pin obvious
    mapMarker.setAnimation(google.maps.Animation.BOUNCE);
    setTimeout(() => {
        mapMarker.setAnimation(null);
    }, 1500);
    
    // Handle both LatLng object and plain {lat, lng} object
    const lat = typeof location.lat === 'function' ? location.lat() : location.lat;
    const lng = typeof location.lng === 'function' ? location.lng() : location.lng;
    
    document.getElementById('mapLatitude').value = lat.toFixed(7);
    document.getElementById('mapLongitude').value = lng.toFixed(7);
    
    // Enable confirm button  
    const confirmBtn = document.getElementById('mapConfirmButton');
    confirmBtn.disabled = false;
    confirmBtn.style.cursor = 'pointer';
    confirmBtn.style.opacity = '1';
    
    // Reverse geocode to get location name if not provided
    if (locationName) {
        document.getElementById('mapLocationName').textContent = `📍 ${locationName}`;
    } else {
        document.getElementById('mapLocationName').textContent = '🔍 Looking up address...';
        mapGeocoder.geocode({ location: { lat, lng } }, (results, status) => {
            if (status === 'OK' && results[0]) {
                document.getElementById('mapLocationName').textContent = `📍 ${results[0].formatted_address}`;
            } else {
                document.getElementById('mapLocationName').textContent = `📍 Location: ${lat.toFixed(6)}, ${lng.toFixed(6)}`;
            }
        });
    }
}

async function handleMapConfirm() {
    const lat = parseFloat(document.getElementById('mapLatitude').value);
    const lng = parseFloat(document.getElementById('mapLongitude').value);
    const locationText = document.getElementById('mapLocationName').textContent.replace('📍 ', '').replace('🔍 Looking up address...', 'Custom Location');
    
    if (isNaN(lat) || isNaN(lng)) {
        alert('Please select a location on the map first');
        return;
    }
    
    // Format as JSON
    const mapData = {
        Latitude: lat,
        Longitude: lng,
        Location: locationText
    };
    
    const mapDataString = JSON.stringify(mapData);
    
    // Store in state for potential Yes/No confirmation
    state.lastMapData = mapDataString;
    console.log('Stored map data for confirmation:', state.lastMapData);
    
    // Remove map UI
    const mapContainer = document.querySelector('.map-container');
    if (mapContainer) {
        mapContainer.remove();
    }
    
    // Reset map instances
    mapInstance = null;
    mapMarker = null;
    mapGeocoder = null;
    
    // Auto-submit the JSON as the answer
    await sendChatMessage(mapDataString);
}

function showFieldsSummary(fields) {
    if (fields.length === 0) return;

    const messagesArea = document.getElementById('messagesArea');
    const lastMessage = messagesArea.lastElementChild;

    const summary = document.createElement('div');
    summary.className = 'fields-summary';
    summary.innerHTML = `<strong>Saved:</strong> ${fields.map(f => f.fieldName).join(', ')}`;

    lastMessage.querySelector('.message-content').appendChild(summary);
}

function showSmartFillTyping() {
    const messagesArea = document.getElementById('messagesArea');
    const existing = document.getElementById('smartFillTyping');
    if (existing) existing.remove();

    const messageDiv = document.createElement('div');
    messageDiv.className = 'message assistant';
    messageDiv.id = 'smartFillTyping';

    const icon = document.createElement('div');
    icon.className = 'message-icon';
    icon.innerHTML = '<i class="ph-thin ph-magic-wand"></i>';

    const contentDiv = document.createElement('div');
    contentDiv.className = 'message-content';
    contentDiv.style.cssText = 'display:flex;align-items:center;gap:10px;';
    contentDiv.innerHTML = '<span style="font-size:13px;color:#6b7280;">Smart Fill — analysing your message</span><div class="typing-indicator"><div class="typing-dot"></div><div class="typing-dot"></div><div class="typing-dot"></div></div>';

    messageDiv.appendChild(icon);
    messageDiv.appendChild(contentDiv);
    messagesArea.appendChild(messageDiv);
    scrollToBottom();
}

function removeSmartFillTyping() {
    const el = document.getElementById('smartFillTyping');
    if (el) el.remove();
}

function showTypingIndicator() {
    const messagesArea = document.getElementById('messagesArea');

    const messageDiv = document.createElement('div');
    messageDiv.className = 'message assistant';
    messageDiv.id = 'typingIndicator';

    const icon = document.createElement('div');
    icon.className = 'message-icon';
    icon.innerHTML = '<i class="ph-thin ph-chats-circle"></i>';

    const contentDiv = document.createElement('div');
    contentDiv.className = 'message-content';
    contentDiv.innerHTML = '<div class="typing-indicator"><div class="typing-dot"></div><div class="typing-dot"></div><div class="typing-dot"></div></div>';

    messageDiv.appendChild(icon);
    messageDiv.appendChild(contentDiv);

    messagesArea.appendChild(messageDiv);
    scrollToBottom();
}

function removeTypingIndicator() {
    const indicator = document.getElementById('typingIndicator');
    if (indicator) indicator.remove();
}

function updateProgress(percentage) {
    state.completionPercentage = percentage;
    document.getElementById('progressBar').style.width = `${percentage}%`;
    document.getElementById('debugProgress').textContent = `${Math.round(percentage)}%`;

    // Update panel
    document.getElementById('panelProgressBar').style.width = `${percentage}%`;
    document.getElementById('panelProgressText').textContent = `${Math.round(percentage)}% complete`;

    // Enable complete button once session has meaningful progress (50%+)
    // 100% may never be reached if some fields are optional
    const completeBtn = document.getElementById('completeBtnPanel');
    if (percentage >= 50 && !state.sessionCompleted) {
        completeBtn.disabled = false;
    }
}

function updateDebugInfo() {
    document.getElementById('debugSession').textContent = state.internalNo || state.regOthId || '-';
    document.getElementById('debugInfo').classList.add('show');

    // Update panel session info
    updateProgressPanel();
}

function toggleProgressPanel() {
    const panel = document.getElementById('progressPanel');
    panel.classList.toggle('show');
}

function updateProgressPanel() {
    // Update session info
    document.getElementById('panelTemplateName').textContent = state.templateName || '-';
    document.getElementById('panelSessionId').textContent = state.regOthId || '-';
    document.getElementById('panelInternalNo').textContent = state.internalNo || '-';

    // Update fields list
    updateFieldsList();
}

function updateFieldsList() {
    const fieldsList = document.getElementById('panelFieldsList');

    if (state.extractedFieldsMap.size === 0) {
        fieldsList.innerHTML = `
            <div style="color: #9ca3af; font-size: 13px; text-align: center; padding: 20px;">
                No fields extracted yet
            </div>
        `;
        return;
    }

    let html = '';
    state.extractedFieldsMap.forEach((field, fieldID) => {
        const fieldName = field.fieldName || fieldID;
        const fieldValue = field.extractedValue || field.value || '';
        const isFilled = fieldValue && fieldValue.trim() !== '';
        html += `
            <div class="extracted-field-item ${isFilled ? 'filled' : ''}">
                <div class="field-name-label">${fieldName}</div>
                <div class="field-value-text">${isFilled ? fieldValue : 'Pending...'}</div>
            </div>
        `;
    });

    fieldsList.innerHTML = html;
}

async function completeSession() {
    if (!state.regOthId) return;

    // Warn if not fully complete but allow them to proceed
    if (state.completionPercentage < 100) {
        const proceed = confirm(
            'Some fields are still missing. You can edit them directly in the form after completing.\n\nDo you want to complete the session now?'
        );
        if (!proceed) return;
    }

    try {
        const response = await fetch(`${CONFIG.apiUrl}/complete`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                regOthID: state.regOthId,
                storeID: CONFIG.storeId,
                completedByID: CONFIG.userId
            })
        });

        const data = await response.json();

        if (data.success) {
            state.sessionCompleted = true;
            // Disable the chat input
            setChatInputState(true, 'Session completed.');
            // Disable the panel button
            const btn = document.getElementById('completeBtnPanel');
            btn.disabled = true;
            btn.textContent = 'Session Completed';
            // Show completion UI in chat
            showCompletionUI(data.missingFields);
        } else {
            // Missing required fields — warn and show which ones
            const missing = data.missingFields?.length
                ? `\n\nMissing: ${data.missingFields.join(', ')}`
                : '';
            const proceed = confirm(
                `Some required fields are incomplete.${missing}\n\nYou can still complete and edit them in the form.\n\nProceed anyway?`
            );
            if (!proceed) return;
            // Force-complete by calling again (backend may block — just show UI)
            state.sessionCompleted = true;
            document.getElementById('completeBtnPanel').disabled = true;
            document.getElementById('completeBtnPanel').textContent = 'Session Completed';
            setChatInputState(true, 'Session completed.');
            showCompletionUI(data.missingFields);
        }
    } catch (error) {
        console.error('Error completing session:', error);
        alert('Error completing session. Please try again.');
    }
}

function showCompletionUI(missingFields) {
    const messagesArea = document.getElementById('messagesArea');

    const messageDiv = document.createElement('div');
    messageDiv.className = 'message assistant';

    const icon = document.createElement('div');
    icon.className = 'message-icon';
    icon.innerHTML = '<i class="ph-thin ph-chats-circle"></i>';

    const contentDiv = document.createElement('div');
    contentDiv.className = 'message-content';

    let msg = ' Session completed! Thank you.';
    if (missingFields && missingFields.length > 0) {
        msg += ` You can edit the missing fields (${missingFields.join(', ')}) directly in the form.`;
    }
    contentDiv.textContent = msg;

    // Two action buttons
    const actionsDiv = document.createElement('div');
    actionsDiv.className = 'suggestions';
    actionsDiv.style.marginTop = '14px';

    const openBtn = document.createElement('button');
    openBtn.className = 'suggestion-pill';
    openBtn.innerHTML = '<i class="ph-thin ph-arrow-square-out" style="margin-right:4px"></i>Open Form';
    openBtn.onclick = () => { const url = getFormUrl(); if (url) window.open(url, '_blank'); };

    const newBtn = document.createElement('button');
    newBtn.className = 'suggestion-pill';
    newBtn.style.background = '#6b7280';
    newBtn.innerHTML = '<i class="ph-thin ph-plus" style="margin-right:4px"></i>Start New';
    newBtn.onclick = () => startNewSession();

    actionsDiv.appendChild(openBtn);
    actionsDiv.appendChild(newBtn);
    contentDiv.appendChild(actionsDiv);

    messageDiv.appendChild(icon);
    messageDiv.appendChild(contentDiv);
    messagesArea.appendChild(messageDiv);
    scrollToBottom();

    if (state.voiceMode) speakText(msg);
}

function startNewSession() {
    // Stop voice mode cleanly before resetting
    if (state.voiceMode) stopVoiceMode();

    // Reset all state
    state.sessionStarted = false;
    state.sessionCompleted = false;
    state.smartFillTriggered = false;
    state.regOthId = null;
    state.internalNo = '';
    state.templateName = '';
    state.moduleName = '';
    state.conversationHistory = [];
    state.extractedFieldsMap = new Map();
    state.completionPercentage = 0;
    state.initialMessage = '';
    state.awaitingTemplateSelection = false;
    state.availableTemplates = [];
    state.pendingResponse = null;
    state.sessionCost = { totalUSD: 0 };
    updateCostDisplay();

    // Reset UI
    document.getElementById('messagesArea').innerHTML = '';
    document.getElementById('messagesArea').classList.remove('active');
    document.getElementById('chatInputArea').style.display = 'none';
    document.getElementById('emptyState').style.display = '';
    setChatInputState(false, 'Type your message...');
    clearAllInputs();
    document.getElementById('progressBar').style.width = '0%';
    document.getElementById('panelProgressBar').style.width = '0%';
    document.getElementById('panelProgressText').textContent = '0% complete';
    document.getElementById('panelTemplateName').textContent = '-';
    document.getElementById('panelSessionId').textContent = '-';
    document.getElementById('panelInternalNo').textContent = '-';
    document.getElementById('panelFieldsList').innerHTML = '<div style="color:#9ca3af;font-size:13px;text-align:center;padding:20px;">No fields extracted yet</div>';
    const btn = document.getElementById('completeBtnPanel');
    btn.disabled = true;
    btn.textContent = 'Complete Session';
    document.getElementById('progressPanel').classList.remove('show');
    document.getElementById('debugInfo').classList.remove('show');
    _historyState.loaded = false; // force refresh next time panel opens
}

function scrollToBottom() {
    const messagesArea = document.getElementById('messagesArea');
    messagesArea.scrollTop = messagesArea.scrollHeight;
}

// ═══════════════════════════════════════════════════════════
//  SESSION HISTORY
// ═══════════════════════════════════════════════════════════

const _historyState = {
    loaded: false,
    page: 1,
    pageSize: 10,
    totalCount: 0,
    items: [],
    expandedId: null   // regOthId whose fields panel is open
};

const SESSION_HISTORY_URL = CONFIG.apiUrl.replace('/chat-template', '/session-history');
const SMART_FILL_URL      = CONFIG.apiUrl.replace('/chat-template', '/smart-fill');

// ── Smart Fill ────────────────────────────────────────────────────────────────

/**
 * Calls POST /api/smart-fill with the current conversation history and shows
 * a confirmation card if the AI can propose values for any fields.
 * Triggered automatically after the first AI response when the toggle is ON.
 */
async function runSmartFill() {
    if (!state.regOthId || !isSmartFillEnabled()) return;

    try {
        const response = await fetch(SMART_FILL_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                regOthID:        state.regOthId,
                storeID:         CONFIG.storeId,
                userProfile:     CONFIG.userProfile,
                chatHistory:     state.conversationHistory,
                currentDateTime: new Date().toISOString(),
                userTimezone:    Intl.DateTimeFormat().resolvedOptions().timeZone,
                userDateFormat:  getUserDateFormat()
            })
        });

        const data = await response.json();
        if (!data.success) {
            removeSmartFillTyping();
            return;
        }

        if (data.proposals && data.proposals.length > 0) {
            showSmartFillCard(data.proposals);
        } else {
            removeSmartFillTyping();
        }
    } catch (err) {
        removeSmartFillTyping();
        console.warn('[SmartFill] API error:', err);
    }
}

/**
 * Renders a confirmation card in the chat area listing all AI proposals.
 * Each proposal has a checkbox so the user can deselect any they don't want.
 */
function showSmartFillCard(proposals) {
    const messagesArea = document.getElementById('messagesArea');
    if (!messagesArea) return;

    // Remove the Smart Fill typing indicator
    removeSmartFillTyping();

    // Remove any existing smart-fill card
    const existing = document.getElementById('smartFillCard');
    if (existing) existing.remove();

    const card = document.createElement('div');
    card.id = 'smartFillCard';
    card.className = 'message assistant';
    card.style.cssText = 'align-items:flex-start;';

    const icon = document.createElement('div');
    icon.className = 'message-icon';
    icon.innerHTML = '<i class="ph-thin ph-magic-wand"></i>';

    const content = document.createElement('div');
    content.className = 'message-content';
    content.style.cssText = 'max-width:100%;';

    const confidenceColor = { high: '#059669', medium: '#d97706', low: '#9ca3af' };

    let rows = proposals.map((p, i) => `
        <label style="display:flex;align-items:flex-start;gap:10px;padding:8px 0;border-bottom:1px solid #f3f4f6;cursor:pointer;">
            <input type="checkbox" class="sf-check" data-index="${i}" checked
                style="margin-top:3px;width:15px;height:15px;accent-color:#2d8eff;flex-shrink:0;">
            <div style="flex:1;min-width:0;">
                <div style="font-weight:600;font-size:13px;color:#374151;">${escapeHtml(p.fieldName)}</div>
                <div style="font-size:13px;color:#111827;margin-top:2px;">${escapeHtml(p.proposedValue)}</div>
                ${p.reasoning ? `<div style="font-size:11px;color:#9ca3af;margin-top:2px;">${escapeHtml(p.reasoning)}</div>` : ''}
            </div>
            <span style="font-size:11px;color:${confidenceColor[p.confidence]||'#9ca3af'};flex-shrink:0;margin-top:3px;">${p.confidence}</span>
        </label>
    `).join('');

    content.innerHTML = `
        <div style="font-weight:600;margin-bottom:10px;color:#374151;">
            Smart Fill found ${proposals.length} value${proposals.length !== 1 ? 's' : ''} — confirm to save:
        </div>
        <div id="sfRows">${rows}</div>
        <div style="display:flex;gap:8px;margin-top:14px;">
            <button id="sfConfirmBtn" onclick="confirmSmartFill(${JSON.stringify(proposals).replace(/"/g, '&quot;')})"
                style="flex:1;padding:8px 14px;background:#2d8eff;color:#fff;border:none;border-radius:8px;font-size:13px;font-weight:600;cursor:pointer;">
                Confirm Selected
            </button>
            <button onclick="document.getElementById('smartFillCard').remove()"
                style="padding:8px 14px;background:#f3f4f6;color:#6b7280;border:none;border-radius:8px;font-size:13px;cursor:pointer;">
                Skip
            </button>
        </div>
    `;

    card.appendChild(icon);
    card.appendChild(content);
    messagesArea.appendChild(card);
    messagesArea.scrollTop = messagesArea.scrollHeight;

    // Store proposals on the card so confirmSmartFill can access them
    card._proposals = proposals;
}

/**
 * Saves the checked proposals via POST /api/smart-fill/confirm then removes the card.
 */
async function confirmSmartFill(proposals) {
    const card = document.getElementById('smartFillCard');
    const checks = card ? card.querySelectorAll('.sf-check') : [];

    // Show loading state on the confirm button
    const confirmBtn = document.getElementById('sfConfirmBtn');
    if (confirmBtn) {
        confirmBtn.disabled = true;
        confirmBtn.innerHTML = '<div class="typing-indicator" style="display:inline-flex;gap:3px;vertical-align:middle;"><div class="typing-dot"></div><div class="typing-dot"></div><div class="typing-dot"></div></div>';
        confirmBtn.style.cursor = 'not-allowed';
        confirmBtn.style.opacity = '0.8';
    }

    const confirmed = [];
    checks.forEach((cb, i) => {
        if (cb.checked && proposals[i]) {
            confirmed.push({ fieldID: proposals[i].fieldID, value: proposals[i].proposedValue });
        }
    });

    if (confirmed.length === 0) {
        if (card) card.remove();
        return;
    }

    try {
        const response = await fetch(`${SMART_FILL_URL}/confirm`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                regOthID:        state.regOthId,
                storeID:         CONFIG.storeId,
                userID:          CONFIG.userId,
                confirmedFields: confirmed
            })
        });

        const data = await response.json();

        if (data.success) {
            // Update local state so the panel reflects the new values
            confirmed.forEach(f => {
                state.extractedFieldsMap.set(String(f.fieldID), {
                    fieldID:        f.fieldID,
                    extractedValue: f.value
                });
            });
            updateFieldsList();

            if (card) card.remove();

            // Show a brief confirmation chip then continue with remaining fields
            addMessage('assistant', `${data.savedCount} field${data.savedCount !== 1 ? 's' : ''} saved by Smart Fill.`);
            setTimeout(() => continueFromSmartFill(), 600);
        } else {
            addMessage('assistant', `Smart Fill saved ${data.savedCount} fields but ${data.errors?.length || 0} failed.`);
            if (card) card.remove();
            setTimeout(() => continueFromSmartFill(), 600);
        }
    } catch (err) {
        // Restore button on error
        if (confirmBtn) {
            confirmBtn.disabled = false;
            confirmBtn.innerHTML = 'Confirm Selected';
            confirmBtn.style.cursor = 'pointer';
            confirmBtn.style.opacity = '1';
        }
        console.warn('[SmartFill] Confirm error:', err);
        addMessage('assistant', ' Smart Fill confirmation failed. Please try again.');
    }
}

/**
 * Silent continuation after Smart Fill — calls /chat without showing a user bubble.
 * Tells the AI to ask the next unanswered field.
 */
async function continueFromSmartFill() {
    const silentMessage = 'Please continue and ask me about the next field that still needs to be filled.';

    // Add to history so AI has context, but do NOT show in chat UI
    state.conversationHistory.push({ role: 'user', content: silentMessage });

    showTypingIndicator();

    try {
        const response = await fetch(`${CONFIG.apiUrl}/chat`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                regOthID:               state.regOthId,
                storeID:                CONFIG.storeId,
                userMessage:            silentMessage,
                userID:                 CONFIG.userId,
                conversationHistory:    state.conversationHistory.slice(-10),
                fullConversationHistory: state.conversationHistory,
                currentDateTime:        new Date().toISOString(),
                userTimezone:           Intl.DateTimeFormat().resolvedOptions().timeZone,
                userDateFormat:         getUserDateFormat(),
                memoryConfidence:       localStorage.getItem('memoryConfidence') || 'medium',
                userProfile:            CONFIG.userProfile
            })
        });

        const data = await response.json();
        removeTypingIndicator();

        if (data.success) {
            addMessage('assistant', data.aiMessage);
            state.conversationHistory.push({ role: 'assistant', content: data.aiMessage });
            trackServerCost(data.tokenUsage);

            state.currentFieldID   = data.currentFieldID;
            state.currentFieldType = data.currentFieldType;

            if (state.currentFieldType !== '10016' && state.lastMapData) {
                state.lastMapData = null;
            }

            setTimeout(() => {
                const existingFileUpload = document.querySelector('.file-upload-container');
                const existingMapContainer = document.querySelector('.map-container');

                if (state.currentFieldType !== '10013' && existingFileUpload) existingFileUpload.remove();
                if (state.currentFieldType !== '10016' && existingMapContainer) existingMapContainer.remove();

                if (state.currentFieldType === '10013') {
                    addFileUploadUI();
                } else if (state.currentFieldType === '10016') {
                    addMapUI(null);
                }

                if (data.nextSuggestedQuestions && data.nextSuggestedQuestions.length > 0
                    && state.currentFieldType !== '10016') {
                    addSuggestions(data.nextSuggestedQuestions);
                }
            }, 50);

            if (data.completionPercentage !== undefined) {
                updateProgress(data.completionPercentage);
            }
            if (data.isComplete && !state.sessionCompleted) {
                setTimeout(() => promptCompletion(), 600);
            }
            updateDebugInfo();
        } else {
            addMessage('assistant', data.errorMessage || 'Unable to continue.');
        }
    } catch (err) {
        removeTypingIndicator();
        console.warn('[SmartFill] Continue error:', err);
    }
}

// ── Tab switching ─────────────────────────────────────────────────────────────
function switchPanelTab(tab) {
    const progressContent = document.getElementById('panelProgressContent');
    const historyContent  = document.getElementById('panelHistoryContent');
    const memoryContent   = document.getElementById('panelMemoryContent');
    const tabProgress     = document.getElementById('tabProgress');
    const tabHistory      = document.getElementById('tabHistory');
    const tabMemory       = document.getElementById('tabMemory');

    // Hide all, deactivate all tabs
    if (progressContent) progressContent.style.display = 'none';
    if (historyContent)  historyContent.style.display  = 'none';
    if (memoryContent)   memoryContent.style.display   = 'none';
    if (tabProgress) tabProgress.classList.remove('active');
    if (tabHistory)  tabHistory.classList.remove('active');
    if (tabMemory)   tabMemory.classList.remove('active');

    if (tab === 'history') {
        if (historyContent) historyContent.style.display = 'block';
        if (tabHistory) tabHistory.classList.add('active');
        if (!_historyState.loaded) {
            loadSessionHistory(1);
        }
    } else if (tab === 'memory') {
        if (memoryContent) memoryContent.style.display = 'block';
        if (tabMemory) tabMemory.classList.add('active');
        loadMemoryPanel();
        loadSessionContextPanel();
        _memoryStale = false;
    } else {
        if (progressContent) progressContent.style.display = 'block';
        if (tabProgress) tabProgress.classList.add('active');
    }
}

// ── User Memory Panel ─────────────────────────────────────────
async function loadMemoryPanel() {
    const listEl = document.getElementById('memoryFactsList');
    if (!listEl) return;

    listEl.innerHTML = '<div style="color:#9ca3af;font-size:13px;text-align:center;padding:20px;">Loading...</div>';

    try {
        const url = `${CONFIG.apiUrl}/memory?userId=${CONFIG.userId}&storeId=${CONFIG.storeId}`;
        const response = await fetch(url);

        if (!response.ok) {
            const text = await response.text();
            listEl.innerHTML = `<div style="color:#ef4444;font-size:12px;padding:10px;">API error ${response.status}:<br><code>${escapeHtml(text.substring(0,200))}</code><br><br><a href="${CONFIG.apiUrl}/memory/debug?userId=${CONFIG.userId}&storeId=${CONFIG.storeId}" target="_blank" style="color:#3B98F1;">Open debug info ↗</a></div>`;
            return;
        }

        const data = await response.json();
        console.log('[Memory] API response:', data);

        if (!data.success) {
            listEl.innerHTML = `<div style="color:#ef4444;font-size:13px;padding:10px;">${escapeHtml(data.message || 'Failed to load memory.')}<br><br><a href="${CONFIG.apiUrl}/memory/debug?userId=${CONFIG.userId}&storeId=${CONFIG.storeId}" target="_blank" style="color:#3B98F1;font-size:12px;">Open debug info ↗</a></div>`;
            return;
        }

        renderMemoryFacts(data.facts || []);
    } catch (err) {
        console.error('[Memory] loadMemoryPanel error:', err);
        if (listEl) listEl.innerHTML = `<div style="color:#ef4444;font-size:12px;padding:10px;">Network error: ${escapeHtml(err.message)}<br><br><a href="${CONFIG.apiUrl}/memory/debug?userId=${CONFIG.userId}&storeId=${CONFIG.storeId}" target="_blank" style="color:#3B98F1;">Open debug info ↗</a></div>`;
    }
}

function renderMemoryFacts(facts) {
    const listEl = document.getElementById('memoryFactsList');
    if (!listEl) return;

    if (!facts || facts.length === 0) {
        listEl.innerHTML = `
            <div style="color:#9ca3af;font-size:13px;text-align:center;padding:24px 0;">
                <i class="ph-thin ph-brain" style="font-size:28px;display:block;margin-bottom:8px;opacity:0.4;"></i>
                No facts remembered yet.<br>
                <span style="font-size:11px;">Complete a session to start building memory.</span>
            </div>`;
        return;
    }

    listEl.innerHTML = facts.map(f => `
        <div class="memory-fact-item">
            <div class="memory-fact-body">
                <div class="memory-fact-label">${escapeHtml(f.label || f.key)}</div>
                <div class="memory-fact-value">${escapeHtml(f.value)}</div>
            </div>
            <button class="memory-fact-delete" title="Forget this fact"
                onclick="deleteMemoryFact('${escapeHtml(f.key)}')">
                <i class="ph-thin ph-trash"></i>
            </button>
        </div>`).join('');
}

async function deleteMemoryFact(key) {
    if (!confirm(`Forget "${key}"?`)) return;

    try {
        const response = await fetch(
            `${CONFIG.apiUrl}/memory/${encodeURIComponent(key)}?userId=${CONFIG.userId}&storeId=${CONFIG.storeId}`,
            { method: 'DELETE' }
        );
        const data = await response.json();
        if (data.success) {
            loadMemoryPanel();
        }
    } catch (err) {
        console.error('Delete memory fact failed:', err);
    }
}

let _memoryRefreshTimer = null;

/**
 * Schedule a memory panel refresh after a short delay.
 * Debounced so rapid field extractions don't cause multiple reloads.
 * The 3s delay gives the fire-and-forget server task time to finish.
 */
function scheduleMemoryRefresh() {
    clearTimeout(_memoryRefreshTimer);
    _memoryRefreshTimer = setTimeout(() => {
        const memoryContent = document.getElementById('panelMemoryContent');
        if (memoryContent && memoryContent.style.display !== 'none') {
            loadMemoryPanel();
            loadSessionContextPanel();
        }
        _memoryStale = true;
    }, 3000);
}

let _memoryStale = false;

// ─── Session Context (This Session) ─────────────────────────────────────────

async function loadSessionContextPanel() {
    const listEl = document.getElementById('sessionContextList');
    if (!listEl || !state.regOthId) return;

    try {
        const res  = await fetch(`${CONFIG.apiUrl}/session-context?sessionId=${state.regOthId}`);
        const data = await res.json();
        renderSessionContextFacts(data.facts || []);
    } catch (err) {
        console.error('[SessionContext] load error:', err);
    }
}

function renderSessionContextFacts(facts) {
    const listEl = document.getElementById('sessionContextList');
    if (!listEl) return;

    if (!facts || facts.length === 0) {
        listEl.innerHTML = `
            <div style="color:#9ca3af;font-size:13px;text-align:center;padding:14px 0;">
                <i class="ph-thin ph-chats" style="font-size:22px;display:block;margin-bottom:6px;opacity:0.4;"></i>
                No facts yet. Start chatting!
            </div>`;
        return;
    }

    listEl.innerHTML = facts.map(f => `
        <div class="memory-fact-item" id="scf-${escapeHtml(f.key)}">
            <div class="memory-fact-body" onclick="startEditSessionFact('${escapeHtml(f.key)}', this)" style="cursor:pointer;flex:1;" title="Click to edit">
                <div class="memory-fact-label">${escapeHtml(formatFactKey(f.key))}</div>
                <div class="memory-fact-value" id="scfval-${escapeHtml(f.key)}">${escapeHtml(f.value)}</div>
            </div>
            <button class="memory-fact-delete" title="Remove this fact"
                onclick="deleteSessionContextFact('${escapeHtml(f.key)}')">
                <i class="ph-thin ph-trash"></i>
            </button>
        </div>`).join('');
}

function formatFactKey(key) {
    return key.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

function startEditSessionFact(key, bodyEl) {
    const valEl = document.getElementById(`scfval-${key}`);
    if (!valEl) return;
    const current = valEl.textContent;

    // Replace value div with inline input
    valEl.style.display = 'none';
    const input = document.createElement('input');
    input.type  = 'text';
    input.value = current;
    input.style.cssText = 'width:100%;border:1px solid #3B98F1;border-radius:4px;padding:3px 6px;font-size:12px;outline:none;';
    bodyEl.appendChild(input);
    input.focus();
    input.select();

    const save = async () => {
        const newVal = input.value.trim();
        input.remove();
        valEl.style.display = '';
        if (newVal && newVal !== current) {
            valEl.textContent = newVal;
            try {
                await fetch(`${CONFIG.apiUrl}/session-context`, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ sessionId: state.regOthId, key, value: newVal })
                });
            } catch (err) { console.error('[SessionContext] edit error:', err); }
        }
    };
    input.addEventListener('blur', save);
    input.addEventListener('keydown', e => { if (e.key === 'Enter') input.blur(); if (e.key === 'Escape') { input.value = current; input.blur(); } });
}

async function deleteSessionContextFact(key) {
    if (!confirm(`Remove "${formatFactKey(key)}" from this session's memory?`)) return;
    try {
        await fetch(
            `${CONFIG.apiUrl}/session-context/${encodeURIComponent(key)}?sessionId=${state.regOthId}`,
            { method: 'DELETE' }
        );
        loadSessionContextPanel();
    } catch (err) { console.error('[SessionContext] delete error:', err); }
}

async function seedSampleMemory(btn) {
    btn.textContent = '...';
    btn.disabled = true;

    try {
        const response = await fetch(
            `${CONFIG.apiUrl}/memory/seed?userId=${CONFIG.userId}&storeId=${CONFIG.storeId}`,
            { method: 'POST' }
        );
        const data = await response.json();
        console.log('[Memory] Seed response:', data);
        if (data.success) {
            await loadMemoryPanel();
        } else {
            const listEl = document.getElementById('memoryFactsList');
            if (listEl) listEl.innerHTML = `<div style="color:#ef4444;font-size:12px;padding:10px;">Seed failed: ${escapeHtml(data.message || 'unknown error')}<br><br><a href="${CONFIG.apiUrl}/memory/debug?userId=${CONFIG.userId}&storeId=${CONFIG.storeId}" target="_blank" style="color:#3B98F1;">Open debug info ↗</a></div>`;
        }
    } catch (err) {
        console.error('[Memory] Seed error:', err);
        alert('Seed error: ' + err.message);
    } finally {
        btn.textContent = 'Sample';
        btn.disabled = false;
    }
}

// ── Load paginated list ──────────────────────────────────────
async function loadSessionHistory(page = 1) {
    const listEl    = document.getElementById('historyList');
    const loadingEl = document.getElementById('historyLoading');
    const emptyEl   = document.getElementById('historyEmpty');

    listEl.innerHTML = '';
    emptyEl.style.display = 'none';
    loadingEl.style.display = 'flex';

    try {
        const url = `${SESSION_HISTORY_URL}?userId=${CONFIG.userId}&storeId=${CONFIG.storeId}`
                  + `&pageSize=${_historyState.pageSize}&pageNumber=${page}`;
        const res = await fetch(url);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);

        const data = await res.json();
        _historyState.loaded     = true;
        _historyState.page       = page;
        _historyState.totalCount = data.totalCount || 0;
        _historyState.items      = data.sessions || [];

        renderHistoryItems(_historyState.items);

    } catch (err) {
        console.error('History load error:', err);
        listEl.innerHTML = `<div class="history-empty">Failed to load history. Please try again.</div>`;
    } finally {
        loadingEl.style.display = 'none';
    }
}

// ── Render cards ─────────────────────────────────────────────
function renderHistoryItems(items) {
    const listEl  = document.getElementById('historyList');
    const emptyEl = document.getElementById('historyEmpty');

    if (!items || items.length === 0) {
        emptyEl.style.display = 'block';
        return;
    }

    listEl.innerHTML = '';

    items.forEach(item => {
        const card = document.createElement('div');
        card.className = 'history-card';
        const id = item.regOthID;
        card.dataset.regOthId = id;

        const badgeClass = item.isInProgress ? 'in-progress' : 'completed';
        const badgeText  = item.isInProgress ? 'In Progress' : 'Completed';

        const createdDate = item.createdDate
            ? new Date(item.createdDate).toLocaleDateString('en-AU', { day: '2-digit', month: 'short', year: 'numeric' })
            : '-';

        card.innerHTML = `
            <div class="history-card-top">
                <div class="history-template-name">${escapeHtml(item.templateName || 'Unnamed')}</div>
                <span class="history-badge ${badgeClass}">${badgeText}</span>
            </div>
            <div class="history-meta">
                <span>#${escapeHtml(item.internalNo || String(id))}</span>
                <span>${createdDate}</span>
                <span>${item.savedFieldCount || 0} field${item.savedFieldCount !== 1 ? 's' : ''} saved</span>
            </div>
            <div class="history-actions">
                <button class="history-btn" onclick="openHistoryForm(${id}, '${escapeHtml(item.formUrl || '')}')">Open Form</button>
                <button class="history-btn" onclick="toggleHistoryDetail(${id})">View Fields</button>
                ${item.isInProgress ? `<button class="history-btn primary" onclick="resumeSession(${id})">Resume</button>` : ''}
            </div>
            <div class="history-fields-panel" id="historyFields_${id}" style="display:none"></div>
        `;

        listEl.appendChild(card);
    });

    // Pagination
    const totalPages = Math.ceil(_historyState.totalCount / _historyState.pageSize);
    if (totalPages > 1) {
        const pager = document.createElement('div');
        pager.className = 'history-pagination';
        pager.innerHTML = `
            <button class="history-page-btn" onclick="loadSessionHistory(${_historyState.page - 1})" ${_historyState.page <= 1 ? 'disabled' : ''}>← Prev</button>
            <span style="font-size:12px;color:#6b7280;align-self:center;">Page ${_historyState.page} of ${totalPages}</span>
            <button class="history-page-btn" onclick="loadSessionHistory(${_historyState.page + 1})" ${_historyState.page >= totalPages ? 'disabled' : ''}>Next →</button>
        `;
        listEl.appendChild(pager);
    }
}

// ── Toggle field detail inline ───────────────────────────────
async function toggleHistoryDetail(regOthId) {
    const panelEl = document.getElementById(`historyFields_${regOthId}`);
    if (!panelEl) return;

    if (panelEl.style.display !== 'none') {
        panelEl.style.display = 'none';
        return;
    }

    panelEl.style.display = 'block';
    panelEl.innerHTML = '<div class="history-loading" style="padding:10px 0;"><div class="loading-spinner-sm"></div><span>Loading fields…</span></div>';

    try {
        const url = `${SESSION_HISTORY_URL}/${regOthId}?userId=${CONFIG.userId}&storeId=${CONFIG.storeId}`;
        const res = await fetch(url);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);

        const detail = await res.json();
        const fields = detail.fields || [];

        if (fields.length === 0) {
            panelEl.innerHTML = '<div style="font-size:12px;color:#9ca3af;text-align:center;padding:8px 0;">No fields saved yet.</div>';
            return;
        }

        panelEl.innerHTML = fields.map(f => `
            <div class="history-field-row">
                <span class="history-field-name">${escapeHtml(f.fieldName || `Field ${f.fieldID}`)}</span>
                <span class="history-field-value">${escapeHtml(f.fieldValue || '-')}</span>
            </div>
        `).join('');

    } catch (err) {
        console.error('History detail error:', err);
        panelEl.innerHTML = '<div style="font-size:12px;color:#ef4444;text-align:center;padding:8px 0;">Failed to load fields.</div>';
    }
}

// ── Open form in new tab ─────────────────────────────────────
function openHistoryForm(regOthId, formUrl) {
    const url = formUrl || `https://beta.whsmonitor.com.au/App/RiskAssessor/ChecklistV2.aspx?regothId=${regOthId}&IsEdit=1`;
    window.open(url, '_blank');
}

// ── Resume session ───────────────────────────────────────────
async function resumeSession(regOthId) {
    try {
        const url = `${SESSION_HISTORY_URL}/${regOthId}?userId=${CONFIG.userId}&storeId=${CONFIG.storeId}`;
        const res = await fetch(url);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);

        const detail = await res.json();

        // ── Restore state ────────────────────────────────────
        state.regOthId         = detail.regOthID;
        state.internalNo       = detail.internalNo || '';
        state.templateName     = detail.templateName || '';
        state.sessionStarted   = true;
        state.sessionCompleted = !detail.isInProgress;

        // Restore extracted fields map
        state.extractedFieldsMap.clear();
        const filledFields = (detail.fields || []).filter(f => f.fieldValue);
        filledFields.forEach(f => {
            state.extractedFieldsMap.set(String(f.fieldID), {
                fieldId:   f.fieldID,
                fieldName: f.fieldName || `Field ${f.fieldID}`,
                value:     f.fieldValue
            });
        });

        // Rebuild conversationHistory so the AI has full context
        const fieldsContext = filledFields.length
            ? filledFields.map(f => `${f.fieldName}: ${f.fieldValue}`).join('; ')
            : 'none yet';
        state.conversationHistory = [
            { role: 'user',      content: `I need to resume filling in the "${state.templateName}" form.` },
            { role: 'assistant', content: `Sure! Resuming your "${state.templateName}" session (ID: ${state.regOthId}). So far we have captured: ${fieldsContext}. Let\'s continue filling in the remaining fields.` }
        ];

        // ── Switch UI ────────────────────────────────────────
        switchPanelTab('progress');
        updateProgressPanel();

        // Ensure chat view is visible (same as when a new session starts)
        document.getElementById('emptyState').style.display = 'none';
        document.getElementById('messagesArea').classList.add('active');
        document.getElementById('chatInputArea').style.display = 'block';

        // ── Clear chat and render resume card ────────────────
        const messagesArea = document.getElementById('messagesArea');
        messagesArea.innerHTML = '';

        const createdDate = detail.createdDate
            ? new Date(detail.createdDate).toLocaleDateString('en-AU', { day: '2-digit', month: 'short', year: 'numeric' })
            : '';

        // Build field rows HTML
        const fieldRowsHtml = filledFields.length
            ? filledFields.map(f => `
                <div class="resume-field-row">
                    <span class="resume-field-name">${escapeHtml(f.fieldName)}</span>
                    <span class="resume-field-value">${escapeHtml(f.fieldValue)}</span>
                </div>`).join('')
            : '<div style="color:#9ca3af;font-size:12px;padding:4px 0;">No fields saved yet.</div>';

        // Inject the resume card as an assistant message
        const messageDiv = document.createElement('div');
        messageDiv.className = 'message assistant';
        messageDiv.innerHTML = `
            <div class="message-icon"><i class="ph-thin ph-chats-circle"></i></div>
            <div class="message-content">
                <div class="resume-card">
                    <div class="resume-card-header">
                        <i class="ph-thin ph-arrow-counter-clockwise"></i>
                        <span>Session Resumed</span>
                    </div>
                    <div class="resume-card-title">${escapeHtml(state.templateName)}</div>
                    ${createdDate ? `<div class="resume-card-date">Started ${createdDate} &nbsp;·&nbsp; ID: ${state.regOthId}</div>` : ''}
                    <div class="resume-fields-label">${filledFields.length} field${filledFields.length !== 1 ? 's' : ''} already captured</div>
                    <div class="resume-fields-list">${fieldRowsHtml}</div>
                </div>
                <div class="resume-continue-msg">Let's pick up where you left off — what would you like to fill in next? Or just say <strong>"next"</strong> and I'll ask you the remaining fields one by one.</div>
            </div>
        `;
        messagesArea.appendChild(messageDiv);
        scrollToBottom();

        // Close panel on mobile
        if (window.innerWidth < 768) {
            document.getElementById('progressPanel').classList.remove('show');
        }

    } catch (err) {
        console.error('Resume session error:', err);
        addMessage('assistant', 'Could not resume that session. Please try again.');
    }
}

// ── Utility ──────────────────────────────────────────────────
function escapeHtml(str) {
    if (!str) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}
