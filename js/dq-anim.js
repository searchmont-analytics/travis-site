// Plays the animated SVG graphics when they scroll into view, with a replay button.
(function(){
  var reduce = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  document.querySelectorAll('.dq-wrap').forEach(function(wrap){
    if (wrap.dataset.dqReady) return;
    wrap.dataset.dqReady = '1';
    var svg = wrap.querySelector('svg.dq');
    var btn = wrap.querySelector('.dq-replay');
    var timers = [];
    function countUp(){
      timers.forEach(clearTimeout); timers = [];
      svg.querySelectorAll('[data-count]').forEach(function(el){
        var target = +el.dataset.count, delay = (+el.dataset.delay || 0) * 1000;
        if (reduce) { el.textContent = target; return; }
        el.textContent = '0';
        timers.push(setTimeout(function(){
          var t0 = performance.now();
          (function step(now){
            var p = Math.min(1, (now - t0) / 1000);
            el.textContent = Math.round(target * (1 - Math.pow(1 - p, 3)));
            if (p < 1) requestAnimationFrame(step);
          })(t0);
        }, delay));
      });
    }
    function play(){ svg.classList.remove('play'); void svg.getBoundingClientRect(); svg.classList.add('play'); countUp(); }
    if ('IntersectionObserver' in window) {
      svg.classList.remove('play');
      var io = new IntersectionObserver(function(entries){
        if (entries[0].isIntersecting) { play(); io.disconnect(); }
      }, {threshold: 0.3});
      io.observe(svg);
    } else { countUp(); }
    btn.addEventListener('click', play);
  });
})();
