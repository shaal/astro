
export function post(params, request) {
	return new Response(null, {
		status: 301,
		headers: {
			'Location': '/',
			'Set-Cookie': 'logged-in=1; Path=/;'
		}
	});
}
