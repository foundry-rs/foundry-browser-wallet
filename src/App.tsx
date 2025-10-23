import { ConnectButton } from "@rainbow-me/rainbowkit";

import "./App.css";

export const App = () => {
  return (
    <>
      <div className="container">
        <img src="/banner.png" alt="Foundry" className="banner" />
        <ConnectButton />
      </div>
    </>
  );
};
