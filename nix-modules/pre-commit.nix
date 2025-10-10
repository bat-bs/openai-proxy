{inputs, ...}: {
  imports = [inputs.pre-commit-hooks.flakeModule];
  perSystem = {
    self',
    lib,
    system,
    config,
    pkgs,
    ...
  }: {
    checks = {
      pre-commit-check = inputs.pre-commit-hooks.lib.${system}.run {
        src = ./.;
        hooks = {
          alejandra.enable = true;
          gofmt = {
            enable = true;
            name = "Gofmt check";
            entry = "${pkgs.go}/bin/gofmt -l";
            pass_filenames = true;
            files = "\\.go$";
          };
          goimports = {
            enable = true;
            name = "Goimports check";
            entry = "${pkgs.gotools}/bin/goimports -l";
            pass_filenames = true;
            files = "\\.go$";
          };
        };
      };
    };
  };
}
