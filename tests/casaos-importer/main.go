// Offline reproduction of AppManagement debfa317 InstallComposeApp ->
// NewComposeAppFromYAML(false,true) -> yaml.Marshal(ComposeApp) -> file reload.
package main

import (
	"encoding/json"
	"fmt"
	"github.com/compose-spec/compose-go/cli"
	"github.com/compose-spec/compose-go/loader"
	"github.com/compose-spec/compose-go/types"
	"gopkg.in/yaml.v3"
	"os"
	"path/filepath"
)

type ComposeApp types.Project

func check(err error) {
	if err != nil {
		panic(err)
	}
}
func main() {
	b, err := os.ReadFile(os.Args[1])
	check(err)
	wd, err := os.MkdirTemp("", "cupmemo-import-")
	check(err)
	defer os.RemoveAll(wd)
	p, err := loader.Load(types.ConfigDetails{ConfigFiles: []types.ConfigFile{{Content: b}}, Environment: map[string]string{}, WorkingDir: wd}, func(o *loader.Options) {
		o.SkipInterpolation = false
		o.SkipValidation = true
		o.Interpolate.LookupValue = func(key string) (string, bool) { return "$" + key, true }
	})
	check(err)
	// Also enforce the schema independently (the live install route skips it).
	_, err = loader.Load(types.ConfigDetails{ConfigFiles: []types.ConfigFile{{Content: b}}, Environment: map[string]string{}, WorkingDir: wd})
	check(err)
	stored, err := yaml.Marshal((*ComposeApp)(p))
	check(err)
	file := filepath.Join(wd, "docker-compose.yml")
	check(os.WriteFile(file, stored, 0600))
	options, err := cli.NewProjectOptions([]string{file}, cli.WithWorkingDirectory(wd), cli.WithOsEnv, cli.WithDotEnv, cli.WithEnv([]string{"AppID=cupmemo"}), cli.WithConfigFileEnv, cli.WithDefaultConfigPath, cli.WithEnvFiles(), cli.WithName("cupmemo"))
	check(err)
	reloaded, err := cli.ProjectFromOptions(options)
	check(err)
	// docker/compose v2.23.3 ProjectOptions.ToProject additionally enables selected
	// services and drops unused resources (including loader's unused default net).
	// CustomLabels/remote resource loaders do not affect this local runtime model.
	check(reloaded.EnableServices())
	reloaded.WithoutUnnecessaryResources()
	check(reloaded.ForServices(nil))
	check(os.WriteFile(os.Args[2], stored, 0600))
	result := map[string]interface{}{"imported": p, "reloaded": reloaded}
	out, err := json.Marshal(result)
	check(err)
	fmt.Println(string(out))
}
