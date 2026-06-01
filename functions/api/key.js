export async function onRequest(context) {
    // Return the API key to the frontend so it can make direct requests
    // and bypass Cloudflare's EU IP restrictions.
    return new Response(JSON.stringify({ key: context.env.GEMINI_API_KEY }), {
        headers: { 
            'Content-Type': 'application/json',
            'Cache-Control': 'no-store'
        }
    });
}
