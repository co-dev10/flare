/*
This JavaScript is used to pre-load Python modules downloaded from raw Python source files into the emulated
emscripten virtual file system so that they can be called from Pyodide.

Please see docs/setup.md in the section "HTML skeleton" for further information on how to use this script.
*/
const SITE_PACKAGES = "/lib/python3.8/site-packages";

class flare {
	constructor(config) {
		this.config = config;

		let indexUrl = "/pyodide"
		fetch(indexUrl+"/pyodide.js").then((res)=>{
			if (res.ok) {
				console.debug(`Using local Pyodide...`);
			}else{
				indexUrl = "https://cdn.jsdelivr.net/pyodide/v0.17.0/full";
				console.debug(`Using Pyodide fallback from ${indexUrl}...`);
			}
			var script = document.createElement("script");
			script.setAttribute("src", indexUrl+"/pyodide.js");
			document.getElementsByTagName("head")[0].appendChild(script);
			script.addEventListener("load",(e)=>{
				this.initPyodide(indexUrl,config);
			})
		})
	}

	initPyodide(indexUrl,config){
		let pyodide_config = {"indexUrl":indexUrl};

		// Await loadPyodide, then run flare config
		loadPyodide(pyodide_config).then(() => {
			let kickoff = config.kickoff || "";

			// Run prelude first
			pyodide.runPythonAsync(config.prelude || "").then(() => {

				// Then fetch sources and import modules
				this.fetchSources(config.fetch || {}).then(() => {
					for(let module of Object.keys(config.fetch || {}))
					{
						if(config.fetch[module].optional === true)  {
							kickoff = `try:\n\timport ${module}\nexcept:\n\tpass\n` + kickoff
						}
						else {
							kickoff = `import ${module}\n` + kickoff
						}
					}

					// Then, run kickoff code
					pyodide.runPythonAsync(kickoff).then(
						() => this.initializingComplete());
				});
			});
		});
	}

	loadPythonFilesAsSitePackage(module, baseURL, files) {
		let promises = [];
		let bar = null;
		let info = null;
		try{
			bar = document.getElementById("loadingbar")
			info = document.getElementById("fileinfo")
			bar.max += files.length
		}catch (e) {}

		for (let f in files) {

			promises.push(
				new Promise((resolve, reject) => {
					let file = files[f];
					let url = (baseURL ? baseURL + "/" : "") + file;

					fetch(url, {}).then((response) => {
						if (response.status === 200)
							return response.text().then((code) => {
								let path = (SITE_PACKAGES + "/" + module + "/" + file).split("/");
								let lookup = "";

								if (bar) {
									bar.value +=1
									info.innerHTML = files[f]
								}

								for (let i in path) {
									if (!path[i]) {
										continue;
									}

									lookup += (lookup ? "/" : "") + path[i];
									if (parseInt(i) === path.length - 1) {
										pyodide._module.FS.writeFile(lookup, code);
										console.debug(`fetched ${lookup}`);
									} else {
										try {
											pyodide._module.FS.lookupPath(lookup);
										} catch {
											pyodide._module.FS.mkdir(lookup);
											console.debug(`created ${lookup}`);
										}
									}
								}

								resolve();
							});
						else
							reject();
					});
				})
			);
		}

		return Promise.all(promises);
	}

	fetchSources(modules) {
		let promises = [];
		pyodide.zipfiles = [];

		for( let module of Object.keys(modules) )
		{
			promises.push(
				new Promise((resolve, reject) => {
				  // First try to download zip-file
				  let zipurl = `${modules[module]["path"]}/files.zip`;
				  fetch(zipurl, {}).then((response) => {
				    if (response.status === 200) {
				      return response.blob().then((blob) => {
                let zipfile = "/" + module + ".zip";

                //pyodide._module.FS.writeFile(zipfile, content);
                //pyodide._module.FS.createPreloadedFile("/", module + ".zip", zipurl, true, false);
                blob.arrayBuffer().then(buffer => {
                  buffer = new Uint8Array(buffer);

                  let stream = pyodide._module.FS.open(zipfile, "w+");
                  pyodide._module.FS.write(stream, buffer, 0, buffer.length, 0);
                  pyodide._module.FS.close(stream);

                  pyodide.zipfiles.push(zipfile);
                  console.debug(`fetched ${zipfile}`);
                  resolve();
                });
              });
            } else {
              let mapfile = `${modules[module]["path"]}/files.json`;
              fetch(mapfile, {}).then((response) => {
                if (response.status === 200) {
                  response.text().then((list) => {
                    let files = [];

                    try {
                      files = JSON.parse(list);
                    }
                    catch (e) {
                      if( modules[module]["optional"] ) {
                        console.info(`Optional module ${module} wasn't found`);
                        return resolve();
                      }
                      else {
                        console.error(`Unable to parse ${mapfile} properly, check for correct config of ${module}`);
                        return reject();
                      }
                    }

                    this.loadPythonFilesAsSitePackage(module, modules[module]["path"], files).then(() => {
                      resolve();
                    })
                  })
                } else {
                  if( modules[module]["optional"] ) {
                    console.info(`Optional module ${module} wasn't found`);
                    return resolve();
                  }

                  reject();
                }
              });
            }
          });

				}));
		}

		return Promise.all(promises).then(() => {
			try{
				let bar = document.getElementById("loadingbar")
				bar.max = bar.value
			}catch (e) {}

			for( let module of Object.keys(modules) ) {
			  pyodide.loadedPackages[module] = "default channel";
			}

			pyodide.runPython(
			  // language=Python
				`
import sys
import importlib as _importlib
from js import window

for zipfile in window.pyodide.zipfiles:
    sys.path.insert(0, zipfile)

_importlib.invalidate_caches()
        `
			);


			try{
				//wrapper
				let wrapper = document.getElementById("wrapper")
				wrapper.style.display="none"
				document.body.classList.add("is-loading")
			}catch (e) {}

		});
	}

	initializingComplete() {
		document.body.classList.remove("is-loading")
	}
}
