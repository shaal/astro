import type { ComponentInstance, EndpointHandler, MarkdownRenderOptions, Params, Props, Renderer, RouteData, SSRElement } from '../../@types/astro';
import type { LogOptions } from '../logger.js';

import { renderEndpoint, renderHead, renderPage } from '../../runtime/server/index.js';
import { getParams } from '../routing/index.js';
import { createResult } from './result.js';
import { findPathItemByKey, RouteCache, callGetStaticPaths } from './route-cache.js';

interface GetParamsAndPropsOptions {
	mod: ComponentInstance;
	route?: RouteData | undefined;
	routeCache: RouteCache;
	pathname: string;
	logging: LogOptions;
}

export async function getParamsAndProps(opts: GetParamsAndPropsOptions): Promise<[Params, Props]> {
	const { logging, mod, route, routeCache, pathname } = opts;
	// Handle dynamic routes
	let params: Params = {};
	let pageProps: Props;
	if (route && !route.pathname) {
		if (route.params.length) {
			const paramsMatch = route.pattern.exec(pathname);
			if (paramsMatch) {
				params = getParams(route.params)(paramsMatch);
			}
		}
		let routeCacheEntry = routeCache.get(route);
		// During build, the route cache should already be populated.
		// During development, the route cache is filled on-demand and may be empty.
		// TODO(fks): Can we refactor getParamsAndProps() to receive routeCacheEntry
		// as a prop, and not do a live lookup/populate inside this lower function call.
		if (!routeCacheEntry) {
			routeCacheEntry = await callGetStaticPaths(mod, route, true, logging);
			routeCache.set(route, routeCacheEntry);
		}
		const matchedStaticPath = findPathItemByKey(routeCacheEntry.staticPaths, params);
		if (!matchedStaticPath) {
			throw new Error(`[getStaticPaths] route pattern matched, but no matching static path found. (${pathname})`);
		}
		// This is written this way for performance; instead of spreading the props
		// which is O(n), create a new object that extends props.
		pageProps = Object.create(matchedStaticPath.props || Object.prototype);
	} else {
		pageProps = {};
	}
	return [params, pageProps];
}

export interface RenderOptions {
	legacyBuild: boolean;
	logging: LogOptions;
	links: Set<SSRElement>;
	markdownRender: MarkdownRenderOptions;
	mod: ComponentInstance;
	origin: string;
	pathname: string;
	scripts: Set<SSRElement>;
	request: Request,
	resolve: (s: string) => Promise<string>;
	renderers: Renderer[];
	route?: RouteData;
	routeCache: RouteCache;
	site?: string;
}

export async function render(opts: RenderOptions): Promise<{ type: 'html', html: string } | { type: 'response', response: Response }> {
	const { legacyBuild, links, logging, origin, markdownRender, mod, pathname, scripts, request, renderers, resolve, route, routeCache, site } = opts;

	const [params, pageProps] = await getParamsAndProps({
		logging,
		mod,
		route,
		routeCache,
		pathname,
	});

	// Validate the page component before rendering the page
	const Component = await mod.default;
	if (!Component) throw new Error(`Expected an exported Astro component but received typeof ${typeof Component}`);
	if (!Component.isAstroComponentFactory) throw new Error(`Unable to SSR non-Astro component (${route?.component})`);

	const result = createResult({
		legacyBuild,
		links,
		logging,
		markdownRender,
		origin,
		params,
		pathname,
		request,
		resolve,
		renderers,
		site,
		scripts,
	});

	let page = await renderPage(result, Component, pageProps, null);

	if(page.type === 'response') {
		return page;
	}

	let html = page.html;
	// handle final head injection if it hasn't happened already
	if (html.indexOf('<!--astro:head:injected-->') == -1) {
		html = (await renderHead(result)) + html;
	}
	// cleanup internal state flags
	html = html.replace('<!--astro:head:injected-->', '');

	// inject <!doctype html> if missing (TODO: is a more robust check needed for comments, etc.?)
	if (!legacyBuild && !/<!doctype html/i.test(html)) {
		html = '<!DOCTYPE html>\n' + html;
	}
	
	return {
		type: 'html',
		html
	};
}
