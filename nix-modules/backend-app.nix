{
  inputs,
  self,
  ...
}: {
  imports = [];
  perSystem = {
    pkgs,
    system,
    config,
    self',
    ...
  }: {
    # Build Go binary from the repository root.
    packages.openai-api-proxy = pkgs.buildGoModule {
      pname = "openai-api-proxy";
      version = "0.1.0";
      src = ../.;
      vendorHash = "sha256-YPlRCpF7+S7imWMiT5YNVLmjctnxdeJpRalU4iuF6wA=";
    };
    # Dev shell with Go and formatting tools.
    devShells.openai-api-proxy-shell = pkgs.mkShell {
      name = "openai-api-proxy-shell";
      packages = with pkgs; [go];
      inputsFrom = [config.treefmt.build.devShell];
    };
    packages.default = self.packages.${system}.openai-api-proxy;
  };
}
