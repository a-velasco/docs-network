import concurrent.futures
import json
import random
import re
import threading
from dataclasses import dataclass, field
from typing import Dict, List, Optional, Set, Tuple
from urllib.parse import urljoin, urlparse, urlunparse
import networkx as nx
import requests
from bs4 import BeautifulSoup


def normalize_url(url: str) -> str:
    """Strips query parameters, fragments, and trailing slashes for unified URL keys."""
    if not url:
        return ""
    p = urlparse(url)
    path = p.path.rstrip('/')
    return urlunparse((p.scheme, p.netloc, path, '', '', ''))


@dataclass
class SiteConfig:
    name: str
    base_url: str
    sitemap: str
    color: str = "#888888"
    prefix: str = ""
    alt_urls: List[str] = field(default_factory=list)

    def __post_init__(self):
        self.base_url = normalize_url(self.base_url)
        self.alt_urls = [normalize_url(u) for u in self.alt_urls if u]


class SitemapGraphBuilder:
    def __init__(self, sites_config: List[dict], max_workers: int = 20):
        self.sites: List[SiteConfig] = [SiteConfig(**s) for s in sites_config]
        self.max_workers = max_workers

        self.valid_nodes: Set[str] = set()
        self.alt_urls: Set[str] = {alt for site in self.sites for alt in site.alt_urls}
        self.graph = nx.DiGraph()

        self._redirect_cache: Dict[str, Optional[str]] = {}
        self._cache_lock = threading.Lock()

    def parse_all_sitemaps(self) -> None:
        print("=== [STEP 1] Parsing Sitemaps ===")
        for site in self.sites:
            print(f"Fetching sitemap for site '{site.name}': {site.sitemap}")
            found_urls = self._parse_sitemap(site.sitemap)
            print(f" -> Found {len(found_urls)} URLs from '{site.name}'")
            self.valid_nodes.update(found_urls)

        for node in self.valid_nodes:
            self.graph.add_node(node)

        print(f"\n[Sitemaps completed] Total unique nodes registered: {len(self.valid_nodes)}\n")

    def _parse_sitemap(self, sitemap_path: str) -> Set[str]:
        urls = set()
        try:
            if sitemap_path.startswith(('http://', 'https://')):
                res = requests.get(sitemap_path, timeout=10)
                text = res.text
            else:
                with open(sitemap_path, 'r', encoding='utf-8') as f:
                    text = f.read()

            loc_matches = re.findall(r'<loc>\s*(.*?)\s*</loc>', text, re.DOTALL | re.IGNORECASE)
            for loc in loc_matches:
                loc = loc.strip().replace('&amp;', '&')
                if loc.endswith('.xml'):
                    urls.update(self._parse_sitemap(loc))
                else:
                    norm = normalize_url(loc)
                    if norm:
                        urls.add(norm)
        except Exception as e:
            print(f"  [Error] Failed to read sitemap '{sitemap_path}': {e}")
        return urls

    def _resolve_redirect(self, url: str) -> Optional[str]:
        """Resolves target URL redirects using an in-memory thread-safe cache."""
        with self._cache_lock:
            if url in self._redirect_cache:
                return self._redirect_cache[url]

        resolved = None
        try:
            res = requests.head(url, allow_redirects=True, timeout=5)
            if res.status_code in (403, 405):
                res = requests.get(url, allow_redirects=True, timeout=5, stream=True)
            resolved = normalize_url(res.url)
        except Exception as e:
            print(f"    [Redirect Error] Failed to resolve target {url}: {e}")
            resolved = None

        with self._cache_lock:
            self._redirect_cache[url] = resolved
        return resolved

    def _process_page(self, url: str) -> List[Tuple[str, str]]:
        edges = []
        try:
            res = requests.get(url, timeout=8)
            if 'text/html' not in res.headers.get('Content-Type', ''):
                return edges

            soup = BeautifulSoup(res.text, 'html.parser')
            main_div = soup.find('div', class_='main')
            if not main_div:
                return edges
            links_found = 0

            for a in main_div.find_all('a', href=True): # parsing main div only to avoid toctree links
                classes = a.get('class', [])
                if isinstance(classes, str):
                    classes = classes.split()

                # Resolves relative paths like '../' (internal refs) against the directory URL
                base_url_for_join = url if url.endswith('/') else f"{url}/"
                target = normalize_url(urljoin(base_url_for_join, a['href']))
                if not target or target == url:
                    continue

                links_found += 1

                # External link to an existing node
                if target in self.valid_nodes:
                    print(f"  [link match] {url} -> {target}")
                    edges.append((url, target))
                    continue

                # External link to an alt_url
                matches_alt = any(target.startswith(alt) for alt in self.alt_urls)
                if matches_alt:
                    print(f"  [alt-url match] Checking redirect for {target}...")
                    resolved_target = self._resolve_redirect(target)

                    if resolved_target and resolved_target in self.valid_nodes and resolved_target != url:
                        print(f"    [resolved match] {target} -> {resolved_target}")
                        edges.append((url, resolved_target))
                    else:
                        print(f"    [resolved invalid] {target} -> {resolved_target} (Not a valid node)")

            print(f"[Scraped Page] {url} (Extracted {links_found} candidate links)")

        except Exception as e:
            print(f"[Fetch Error] Failed to process page {url}: {e}")
            print('a')

        return edges

    def build_edges(self) -> None:
        """Scrapes outbound links for all valid nodes concurrently."""
        print(f"=== [STEP 2] Processing {len(self.valid_nodes)} Pages ===")
        processed_count = 0
        total_nodes = len(self.valid_nodes)

        with concurrent.futures.ThreadPoolExecutor(max_workers=self.max_workers) as executor:
            future_to_url = {executor.submit(self._process_page, url): url for url in self.valid_nodes}

            for future in concurrent.futures.as_completed(future_to_url):
                processed_count += 1
                edges = future.result()

                for src, dst in edges:
                    if self.graph.has_edge(src, dst):
                        self.graph[src][dst]['weight'] += 1
                    else:
                        self.graph.add_edge(src, dst, weight=1)

                if processed_count % 10 == 0 or processed_count == total_nodes:
                    print(f"--- Progress: {processed_count}/{total_nodes} pages completed ---")

        print(f"\n[Processing Completed] Discovered {self.graph.number_of_edges()} unique edge connections.\n")

    def export_graphology_json(self, output_file: str = "graph.json") -> None:
        """Exports graph to Graphology JSON format with randomized node positions."""
        print(f"=== [STEP 3] Exporting Graph to '{output_file}' ===")
        graphology_data = {
            "options": {"type": "directed", "multi": False},
            "nodes": [],
            "edges": []
        }

        for node in self.graph.nodes():
            x = random.uniform(-500, 500)
            y = random.uniform(-500, 500)

            color = "#888888"
            size = 5.0
            label = node.split('/')[-1] or node

            for site in self.sites:
                if site.base_url in node:
                    color = site.color
                    prefix = f"{site.prefix}: " if site.prefix else ""
                    label = f"{prefix}{label}"
                    if node == site.base_url:
                        label = site.name
                        size = 12.0
                    break

            graphology_data["nodes"].append({
                "key": node,
                "attributes": {
                    "x": x,
                    "y": y,
                    "size": size,
                    "color": color,
                    "type": "circle",
                    "label": label
                }
            })

        for source, target, attrs in self.graph.edges(data=True):
            graphology_data["edges"].append({
                "source": source,
                "target": target,
                "attributes": {
                    "weight": attrs.get("weight", 1),
                    "type": "arrow",
                    "color": "#7A7A7A"
                }
            })

        with open(output_file, "w", encoding="utf-8") as f:
            json.dump(graphology_data, f, indent=2)

        print(f"Successfully wrote {len(graphology_data['nodes'])} nodes and {len(graphology_data['edges'])} edges to {output_file}.")
