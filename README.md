# Documentation network graph

This repository contains Python script that builds a network graph of links between documentation sets, and a Node.js app that displays the result in a local webserver.

<img width="1061" height="622" alt="image" src="https://github.com/user-attachments/assets/b994ffab-91cd-46fb-8fed-dc9518b6e970" />

## Quickstart

To browse the demo above, visit https://a-velasco.github.io/docs-network/

To try out other doc sets, you'll need to run it locally.

The easiest and quickest way is via a precompiled build, so you won't have to install or configure anything locally.

Download [offline-launcher.zip](https://github.com/a-velasco/docs-network/releases/download/dev/offline-launcher.zip) and extract it somewhere locally.

Inside the `offline-launcher/` folder, run the shell script `launch-app.sh`:

```shell
cd offline-launcher
. launch-app.sh
```

This should open up a tab in your browser with the application and a demo dataset, similar to the image at the top.

## Alternative installation (with Node.js)

If running the application with the method above doesn't work for you or you prefer compiling the Node.js app locally, this section is for you. Otherwise, skip.

First, install Node.js and npm: https://docs.npmjs.com/downloading-and-installing-node-js-and-npm

Clone this repo and compile the application:

```terminal
git clone git@github.com:a-velasco/docs-network.git
cd docs-network
npm ci
```

When it finishes building, launch with

```terminal
npm run dev
```

Open the `localhost` address shown in the terminal in a browser to see the app.

## UI overview

<img width="206" height="183" alt="image" src="https://github.com/user-attachments/assets/d9c7a9b0-f00d-4edd-aff9-245d73456942" />

On the top left side of the UI, the **Search nodes** box lets you search for node by label, which is based on the last part of their URL. It's a big buggy right now, but it'll help you find specific pages.

For example, the node for `snapcraft.io/docs/reference/administration/network-requirements/` will have the label `snapd:network-requirements`.

The **Simulate graph forces** button will activate a [Force Atlas 2 calculation](https://journals.plos.org/plosone/article?id=10.1371/journal.pone.0098679) with some arbitrary settings I made up because it looked cool.
It'll stop moving automatically after a few seconds, but to stop it yourself just click the button again. (Known bug: the button text disappears while the simulation is active)

**Hover depth** defines what counts as a neighbor when you hover over a node to see its neighborhood. By default it's set to 1, so if you hover over a node, all other nodes will get muted except for the ones immediately connected to it.
If you increase hover depth to 2 hops, then hovering over that same node will include the nodes connected to it, and the nodes connected to _those_.

> [!TIP]
> Click on a node to lock its neighborhood and keep it highlighted. Click anywhere else to revert.

On the top right side, there is a list of numbered "communities" you can toggle. This is the result of the [Louvain method for community detection](https://en.wikipedia.org/wiki/Louvain_method), another fancy algorithm I configured somewhat arbitrarily to see what it does with our data.

<img width="679" height="519" alt="image" src="https://github.com/user-attachments/assets/fa4fce09-7764-41a6-b1ef-1ab89dbf58c6" />

It finds "communities" based on how influential nodes are to the topology of the rest of their community. As expected, the resulting communities tend to encompass a large majority of nodes from one doc set. It's interesting to see which parts of that doc set are excluded into a different community, presumably due to lower interconnectedness. 

## Load other documentation sets

We can do this the easy way, or the hard way. (I've always wanted to say that)

The easy way to visualize other doc sets is using existing graph files I've already generated for a few doc sets in the Ubuntu and Juju worlds.

If you want to add a doc set that I haven't included yet, we'll have to go the _hard way_.

### Existing graph files

You can find pre-baked graph data in the `/pre-made-graphs` directory of both the repository and the offline-launcher:

`/pre-made-graphs/ubuntu.json`:
* Ubuntu Core
* Ubuntu Desktop
* Ubuntu Server
* Ubuntu WSL
* Ubuntu for Developers

`/pre-made-graphs/ubuntu-and-snap.json` (original demo):
* (everything from `ubuntu.json`)
* Snapd
* Snapcraft

`/pre-made-graphs/snap.json`:
* Snapd
* Snapcraft

`/pre-made-graphs/juju.json`:
* Juju CLI
* Charmcraft
* Ops
* Jubilant
* Terraform Juju
* JAAS

**If you're using the offline launcher**: The application displays whatever data is located in `offline-launcher/app/graph.json`, so copy the JSON file you're interested in, and replace `offline-launcher/app/graph.json`. Note that it _must_ be named `graph.json`.

**If you compiled the app in the repo with Node.js**: The application reads from `docs-network/graph.json`, so replace this with the JSON file you want. 

### Add a new doc set

Adding a new documentation set, or generating a graph with a different combination of doc sets, will involve modifying some files in the repository.

Clone it if you haven't already:

```terminal
git clone git@github.com:a-velasco/docs-network.git
cd docs-network
```

Let's say we want to add Ubuntu Pro: https://ubuntu.com/pro/docs/

First, we need to find the sitemap. Sitemaps are the source of truth for generating our node pool. In this case, it's at https://ubuntu.com/pro/docs/doc-sitemap.xml.

Copy the sitemap data to a new file at `/graph-generation/sitemaps/ubuntu-pro.xml`. (This will be automated in the future, but for now I'm seeing some discrepancies between canonical URLs and sitemap URLs for some doc sets. Doing this manually for now ensures we're using the right URLs)

Open `/graph-generation/input.json` -- this is the list of documentation sets our program has access to. Add an entry for Ubuntu Pro:

```json
  {
      "name": "Ubuntu Pro",
      "base_url": "https://ubuntu.com/pro/docs/",
      "alt_urls": [],
      "sitemap": "sitemaps/ubuntu-pro.xml",
      "prefix": "ubuntu-pro"
  },
```
Note that `"base_url"` has to be the base URL used in the sitemap. For doc sites with versioning, this would include the version slug too. 

If you know that some doc sets still link to Ubuntu Pro via an old URL, like a `documentation.ubuntu.com` one, then you can add it to `"alt-urls"`. The script will take this into account so that those connections aren't missed.

Lastly, open `/graph-generation/main.py` and behold my laziness to make an input parser. Add a new entry to the `DOC_SETS` list, and comment/uncomment the rest according to what you want to generate.

For example, to add the new Ubuntu Pro entry and generate a graph with its connections to Ubuntu Core:

```python
DOC_SETS = [
    # "juju-cli",
    # "charmcraft",
    # "ops",
    # "jaas",
    # "juju-terraform",
    # "jubilant",
    "ubuntu-core",
    "ubuntu-pro",
    # "ubuntu-desktop",
    # "ubuntu-server",
    # "ubuntu-developers",
    # "ubuntu-wsl",
    # "snapcraft",
    # "snapd"
]
```

Now, set up your Python environment, run `main.py`, and don't show this to a real Python developer:

```terminal
cd graph-generation
python3 -m venv .venv/
pip3 install -r requirements.txt
python3 main.py
```

**If you're using the pre-built app**, then copy or move the newly generated `docs-network/graph-generation/graph.json` to `offline-launcher/app/graph.json`. You may need to refresh the browser.

**If you're running the app from the repo with Node.js**, then move the newly generated `docs-network/graph-generation/graph.json` to `docs-network/graph.json` and refresh the browser.
