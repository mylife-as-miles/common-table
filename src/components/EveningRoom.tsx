/** A static, original restaurant set. Light moves only in response to the pointer. */
export function EveningRoom() {
  return (
    <div className="evening-room" aria-hidden="true">
      <div className="room-plaster" />
      <div className="room-window">
        <i />
        <i />
        <i />
        <i />
        <span />
      </div>
      <div className="room-wainscot" />
      <div className="room-pendant room-pendant-one">
        <i className="pendant-cord" />
        <i className="pendant-cap" />
        <i className="pendant-shade" />
        <i className="pendant-bulb" />
        <i className="pendant-light" />
      </div>
      <div className="room-pendant room-pendant-two">
        <i className="pendant-cord" />
        <i className="pendant-cap" />
        <i className="pendant-shade" />
        <i className="pendant-bulb" />
        <i className="pendant-light" />
      </div>
      <div className="room-table-plane">
        <div className="room-grain" />
      </div>
      <div className="room-light-pool" />
      <div className="room-vignette" />
    </div>
  );
}
