/// urun.js

try {
  document.addEventListener("keydown", function (e) {
  if (e.key == "~" && e.ctrlKey) {
    try {
      chrome.permissions.request({
        permissions: ['tabs'],
        origins: ['https://www.google.com/']
      }, (granted) => {
        // The callback argument will be true if the user granted the permissions.
        if (granted) {
          alert("starting... please wait");
        } else {
          alert("permissions denied ending process");
        }
      }); // Added closing brace for the try block
    } catch(error) {
      // Handle the error
      console.error("An error occurred: " + error);
    }
  }
});
} catch(error) {
  alert(error)
}
