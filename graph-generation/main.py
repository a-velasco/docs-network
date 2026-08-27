from graph_builder import *
import json

# Uncomment the documentation sets you want to include in the graph
DOC_SETS = [
    # "juju-cli",
    # "charmcraft",
    # "ops",
    # "jaas",
    # "juju-terraform",
    # "jubilant",
    "ubuntu-core",
    # "ubuntu-desktop",
    # "ubuntu-server",
    # "ubuntu-developers",
    # "ubuntu-wsl",
    # "snapcraft",
    # "snapd"
]

if __name__ == "__main__":

    sites_input = []

    with open("input.json", "r") as f:
        all_sets = json.load(f)
        for doc_set in all_sets:
            if doc_set["prefix"] in DOC_SETS:
                doc_set["color"] = f"#{random.randint(0, 0xFFFFFF):06x}" # assign random color to each doc set
                sites_input.append(doc_set)

    builder = GraphBuilder(sites_input)

    print("Building node set from sitemaps...")
    builder.parse_all_sitemaps()

    print("Processing links and resolving redirects...")
    builder.build_edges()

    print("Exporting to JSON...")
    builder.export_graphology_json("graph.json")