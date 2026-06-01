export async function onRequestPost(context) {
    // context.request, context.env are provided by Cloudflare
    const { request, env } = context;

    try {
        const body = await request.json();
        
        // Use the API key from Cloudflare Environment Variables
        const apiKey = env.GEMINI_API_KEY;
        if (!apiKey) {
            return new Response(JSON.stringify({ error: "API key is not configured on the server." }), { 
                status: 500, 
                headers: { 'Content-Type': 'application/json' }
            });
        }

        // Call Google Gemini API
        const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:generateContent?key=${apiKey}`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify(body)
        });

        const data = await response.json();
        
        return new Response(JSON.stringify(data), { 
            status: response.status,
            headers: { 'Content-Type': 'application/json' }
        });
        
    } catch (err) {
        return new Response(JSON.stringify({ error: err.message }), { 
            status: 500,
            headers: { 'Content-Type': 'application/json' }
        });
    }
}
