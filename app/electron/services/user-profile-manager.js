const fs = require('fs');
const path = require('path');
const { app } = require('electron');
let GoogleGenerativeAI;
try {
    GoogleGenerativeAI = require('@google/generative-ai').GoogleGenerativeAI;
} catch(e) {
    console.error('[UserProfileManager] @google/generative-ai not found');
}

const stripHtml = (html) => {
    return (html || '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&quot;/g, '"')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&nbsp;/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
};

const gatherMemorySamples = (chats = []) => {
    let samples = [];

    if (chats && Array.isArray(chats)) {
        const recentChats = chats.slice(0, 5);
        recentChats.forEach(chat => {
            const msgs = chat.messages || [];
            const chatText = msgs.map(m => `${m.role === 'user' ? 'User' : 'NOVA'}: ${m.text}`).join('\n');
            samples.push(`--- RECENT CHAT ---\n${chatText}\n`);
        });
    }

    const activityJsonPath = path.join(
        path.dirname(app.getPath('exe')),
        'Nova_Vault', 'MyActivity.json'
    );
    const activityJsonAlt = path.join(
        __dirname, '..', '..', 'Nova_Vault', 'MyActivity.json'
    );
    const jsonPath = fs.existsSync(activityJsonPath) ? activityJsonPath
                   : fs.existsSync(activityJsonAlt)  ? activityJsonAlt
                   : null;

    if (jsonPath) {
        try {
            const rawJson = fs.readFileSync(jsonPath, 'utf8');
            const activities = JSON.parse(rawJson);
            const recentActivities = activities.slice(0, 100);
            
            recentActivities.forEach(entry => {
                const title = entry.title || '';
                const htmlChunks = (entry.safeHtmlItem || []).map(h => stripHtml(h.html)).join(' ');
                if (htmlChunks.length > 0 || title.length > 0) {
                    samples.push(`--- VAULT MEMORY ---\n${title}\n${htmlChunks.substring(0, 300)}`);
                }
            });
        } catch(e) {
            console.error('[UserProfileManager] Failed to read MyActivity.json', e);
        }
    }

    const combined = samples.join('\n\n');
    return combined.length > 50000 ? combined.substring(0, 50000) : combined;
};

const analyzeUserGraph = async (apiKey, chats = []) => {
    if (!apiKey) {
        console.warn('[UserProfileManager] No API key provided for context sync.');
        return null;
    }
    if (!GoogleGenerativeAI) {
      console.warn('[UserProfileManager] GoogleGenerativeAI not initialized.');
      return null;
    }

    const contextFilePath = path.join(app.getPath('userData'), 'nova_user_context.json');

    const modelsToTry = ['gemini-3.8-flash', 'gemini-4-argon'];
    const apiVersions = ['v1beta', 'v1'];
    
    if ((global.profileAnalysisFailCount || 0) >= 3) {
        return null;
    }

    const lastAttemptTime = global.lastAnalysisAttemptTime || 0;
    const fifteenMinutes = 15 * 60 * 1000;
    if (Date.now() - lastAttemptTime < fifteenMinutes) {
        return null;
    }
    
    global.lastAnalysisAttemptTime = Date.now();

    try {
        const sampledData = gatherMemorySamples(chats);
        if (!sampledData || sampledData.trim().length === 0) return null;

        const prompt = `You are a Psychological & Operations Profiler. Analyze the following user data and extract their persona, language style, and interests.
USER DATA:
${sampledData}`;

        let profileContext = null;
        let success = false;

        for (const modelName of modelsToTry) {
            try {
                console.log(`[UserProfileManager] Sync Attempt: ${modelName} (v1beta)`);
                const genAI = new GoogleGenerativeAI(apiKey);
                const model = genAI.getGenerativeModel({ model: modelName }, { apiVersion: 'v1beta' });
                
                const result = await model.generateContent(prompt, { 
                    timeout: 30000 
                });
                
                const response = await result.response;
                profileContext = response.text();
                
                if (profileContext) {
                    success = true;
                    break;
                }
            } catch (err) {
                console.warn(`[UserProfileManager] ${modelName} failed: ${err.message.split('\n')[0]}`);
                if (err.message.includes('404')) break;
            }
        }

        if (success && profileContext) {
            fs.writeFileSync(contextFilePath, JSON.stringify({
                lastUpdated: Date.now(),
                context: profileContext.trim()
            }, null, 2));
            console.log('[UserProfileManager] ✓ User profile synced successfully.');
            global.lastAnalysisFailureTime = 0;
            return profileContext.trim();
        }

        throw new Error("All models and API versions exhausted.");

    } catch (e) {
        global.profileAnalysisFailCount = (global.profileAnalysisFailCount || 0) + 1;
        if (global.profileAnalysisFailCount >= 3) {
            console.error('[UserProfileManager] Analysis failed 3 times. DISABLING background tasks for this session.');
        } else {
            console.warn(`[UserProfileManager] Attempt ${global.profileAnalysisFailCount} failed. Retrying later...`);
        }
    }
    return null;
};

const getUserContext = () => {
    const contextFilePath = path.join(app.getPath('userData'), 'nova_user_context.json');
    if (fs.existsSync(contextFilePath)) {
        try {
            const data = JSON.parse(fs.readFileSync(contextFilePath, 'utf-8'));
            return data.context;
        } catch(e) {}
    }
    return '';
};

module.exports = {
    analyzeUserGraph,
    getUserContext
};
