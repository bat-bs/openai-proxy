{inputs, ...}: {
  perSystem = {
    self,
    pkgs,
    config,
    system,
    ...
  }: {
    # Default dev shell pulls in Go tooling and treefmt formatting.
    devShells.default = pkgs.mkShell {
      name = "openai-api-proxy-shell";
      inputsFrom = [
        config.devShells.openai-api-proxy-shell
        config.treefmt.build.devShell
      ];
      shellHook = "
        ${config.checks.pre-commit-check.shellHook}
        echo 'Welcome to the OpenAI Proxy dev environment'
      ";
    };
  };
}
