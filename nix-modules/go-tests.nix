{inputs, ...}: {
  perSystem = {
    self,
    pkgs,
    config,
    system,
    ...
  }: {
    checks = {
      go-tests = inputs.pre-commit-hooks.lib.${system}.run {
        # The pre-commit runner executes inside the module file's directory
        # (`nix-modules`). The Go module (go.mod) lives in the repository root,
        # so point `src` one level up so `go test ./...` runs from the project root.
        src = ../.;
        hooks = {
          go-test = {
            enable = true;
            name = "Go unit tests";
            # Run the repository tests. We do not pass filenames because
            # tests should run for the whole repository.
            entry = "${pkgs.go}/bin/go test ./...";
            pass_filenames = false;
            files = ".*";
          };
        };
      };
    };
  };
}
